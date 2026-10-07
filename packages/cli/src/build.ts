import { build as esbuild, type Plugin } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SDK_MAJOR } from '@puck-remote/sdk/constants'
import { ISOLATE_SHIMS } from '@puck-remote/sdk/shims'
import { BuildError, toJson, validateAdapter, validateDefinition, type BlockMeta } from './validate.ts'

export interface Manifest {
  artifactVersion: string
  sdkMajor: number
  createdAt: string
  files: Record<string, string>
  blocks: Record<string, BlockMeta>
  root: BlockMeta | null
  adapters: Record<string, { origin: string }>
  categories: Record<string, { title?: string; components: string[]; defaultExpanded?: boolean; visible?: boolean }>
}

export interface BuildOptions {
  cwd: string
  outDir?: string
  /** Suppress console output (tests). */
  quiet?: boolean
}

interface Sources {
  blocks: { name: string; file: string }[]
  root: string | null
  adapters: string[]
  categories: string | null
}

const SOURCE_EXT = /\.(tsx|ts|jsx|js)$/

async function listSources(cwd: string): Promise<Sources> {
  const ls = async (dir: string) =>
    existsSync(path.join(cwd, dir)) ? (await readdir(path.join(cwd, dir))).filter((f) => SOURCE_EXT.test(f)).sort() : []
  const blocks = (await ls('blocks')).map((f) => ({ name: f.replace(SOURCE_EXT, ''), file: path.join(cwd, 'blocks', f) }))
  for (const b of blocks) {
    if (!/^[a-z][a-z0-9-]*$/.test(b.name)) throw new BuildError(`blocks/${b.name}: block file names must be lowercase slugs`)
  }
  const pick = (cands: string[]) => cands.map((c) => path.join(cwd, c)).find((p) => existsSync(p)) ?? null
  return {
    blocks,
    root: pick(['root.tsx', 'root.jsx', 'root.ts']),
    adapters: (await ls('adapters')).map((f) => path.join(cwd, 'adapters', f)),
    categories: pick(['config/categories.ts', 'config/categories.js']),
  }
}

function registrySource(s: Sources): string {
  const lines: string[] = []
  s.blocks.forEach((b, i) => lines.push(`import b${i} from ${JSON.stringify(b.file)};`))
  s.adapters.forEach((a, i) => lines.push(`import a${i} from ${JSON.stringify(a)};`))
  if (s.root) lines.push(`import root from ${JSON.stringify(s.root)};`)
  if (s.categories) lines.push(`import categories from ${JSON.stringify(s.categories)};`)
  lines.push(`const blocks = { ${s.blocks.map((b, i) => `${JSON.stringify(b.name)}: b${i}`).join(', ')} };`)
  lines.push(`const adapterList = [${s.adapters.map((_, i) => `a${i}`).join(', ')}];`)
  lines.push(`const adapterFiles = ${JSON.stringify(s.adapters.map((a) => path.basename(a)))};`)
  lines.push(`const rootDef = ${s.root ? 'root' : 'null'};`)
  lines.push(`const categoriesDef = ${s.categories ? 'categories' : '{}'};`)
  return lines.join('\n')
}

/** Resolve react / react-dom from the developer repo so the bundle has exactly one React copy. */
function singleReact(cwd: string): Plugin {
  const req = createRequire(path.join(cwd, 'package.json'))
  return {
    name: 'single-react',
    setup(b) {
      b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({ path: req.resolve(args.path) }))
    },
  }
}

const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex')

async function listFiles(dir: string, base = dir): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p, base)))
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out.sort()
}

export async function build(opts: BuildOptions): Promise<{ manifest: Manifest; outDir: string }> {
  const cwd = path.resolve(opts.cwd)
  const outDir = path.resolve(cwd, opts.outDir ?? 'dist')
  const log = opts.quiet ? () => {} : (m: string) => console.log(`[puck-remote build] ${m}`)
  const sources = await listSources(cwd)
  if (sources.blocks.length === 0) throw new BuildError('no blocks found in blocks/')

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const common = {
    bundle: true,
    write: false,
    jsx: 'automatic' as const,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent' as const,
    plugins: [singleReact(cwd)],
  }

  // 1. Metadata: import the definitions in Node on the developer's machine (trusted) and serialize.
  const metaEntry = `${registrySource(sources)}
export default { blocks, adapterList, adapterFiles, rootDef, categoriesDef };`
  const metaBuild = await esbuild({
    ...common,
    stdin: { contents: metaEntry, resolveDir: cwd, loader: 'tsx', sourcefile: 'puck-remote-meta-entry.tsx' },
    format: 'esm',
    platform: 'node',
  })
  const metaFile = path.join(outDir, `.meta-${process.pid}-${Date.now()}.mjs`)
  await writeFile(metaFile, metaBuild.outputFiles![0].text)
  let mod: any
  try {
    mod = (await import(pathToFileURL(metaFile).href)).default
  } finally {
    await rm(metaFile, { force: true })
  }

  const adapters: Manifest['adapters'] = {}
  mod.adapterList.forEach((def: unknown, i: number) => {
    const a = validateAdapter(def, mod.adapterFiles[i])
    if (adapters[a.name]) throw new BuildError(`adapters/${mod.adapterFiles[i]}: duplicate adapter name "${a.name}"`)
    adapters[a.name] = { origin: a.origin }
  })
  const adapterNames = new Set(Object.keys(adapters))

  const blocks: Manifest['blocks'] = {}
  for (const { name } of sources.blocks) {
    if (name.startsWith('__')) throw new BuildError(`blocks/${name}: names starting with "__" are reserved`)
    blocks[name] = validateDefinition(mod.blocks[name], 'block', name, adapterNames)
  }
  const root = mod.rootDef ? validateDefinition(mod.rootDef, 'root', 'root', adapterNames) : null

  const categories = toJson(mod.categoriesDef, 'config/categories') as Manifest['categories']
  for (const [key, c] of Object.entries(categories)) {
    c.components ??= []
    for (const comp of c.components) {
      if (!blocks[comp]) throw new BuildError(`config/categories.${key}: unknown block "${comp}"`)
    }
  }
  for (const [name, b] of Object.entries(blocks)) {
    if (!b.category) continue
    const cat = (categories[b.category] ??= { title: b.category, components: [] })
    if (!cat.components.includes(name)) cat.components.push(name)
  }

  // 2. Isolate bundle: shims + React + react-dom/server + SDK runtime + developer code, as one IIFE.
  const isolateEntry = `${registrySource(sources)}
import { install } from '@puck-remote/sdk/runtime';
const adapters = {};
for (const a of adapterList) adapters[a.name] = a;
install({ blocks, root: rootDef, adapters });`
  const isolateBuild = await esbuild({
    ...common,
    stdin: { contents: isolateEntry, resolveDir: cwd, loader: 'tsx', sourcefile: 'puck-remote-isolate-entry.tsx' },
    format: 'iife',
    platform: 'neutral',
    mainFields: ['browser', 'module', 'main'],
    conditions: ['browser'],
    target: 'es2022',
    minify: true,
    banner: { js: ISOLATE_SHIMS },
  })
  const bundle = isolateBuild.outputFiles![0].text
  await writeFile(path.join(outDir, 'bundle.js'), bundle)

  // 3. Assets.
  if (existsSync(path.join(cwd, 'assets'))) await cp(path.join(cwd, 'assets'), path.join(outDir, 'assets'), { recursive: true })

  const files: Record<string, string> = {}
  for (const rel of await listFiles(outDir)) files[rel] = sha256(await readFile(path.join(outDir, rel)))

  const pkg = existsSync(path.join(cwd, 'package.json')) ? JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) : {}
  const manifest: Manifest = {
    artifactVersion: `${pkg.version ?? '0.0.0'}+${files['bundle.js'].slice(0, 12)}`,
    sdkMajor: SDK_MAJOR,
    createdAt: new Date().toISOString(),
    files,
    blocks,
    root,
    adapters,
    categories,
  }
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  log(`${Object.keys(blocks).length} blocks, ${Object.keys(adapters).length} adapters, bundle ${(bundle.length / 1024).toFixed(0)} KB → ${path.relative(process.cwd(), outDir) || outDir}`)
  return { manifest, outDir }
}
