/**
 * Test 21: the build rejects anything that is not declarative JSON (plus a happy path).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { Parser } from 'tar'
import { BROWSER_EXTERNALS, BROWSER_MODULES_GLOBAL, build, BuildError, generateThemeName, packDist, resolveTheme, writePackage } from '../src/index.ts'
import { apiKey, getDevTheme, setDevTheme } from '../src/themes.ts'
import { loadCliConfig } from '../src/config.ts'
import { diffManifests } from '../src/diff.ts'

// Fixtures must live under this package so `@puck-remote/sdk` and `react` resolve.
const ROOT = path.join(import.meta.dirname, '.fixtures')
const made: string[] = []
afterAll(() => Promise.all(made.map((d) => rm(d, { recursive: true, force: true }))))

async function theme(files: Record<string, string>) {
  await mkdir(ROOT, { recursive: true })
  const dir = await mkdtemp(path.join(ROOT, 't-'))
  made.push(dir)
  for (const [f, src] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, f)), { recursive: true })
    await writeFile(path.join(dir, f), src)
  }
  return dir
}

const block = (body: string) => `import { defineBlock, find, Slot } from '@puck-remote/sdk'\nexport default ${body}\n`
const ok = `defineBlock({ fields: { title: { type: 'text' } }, render: (p) => <h1>{p.title}</h1> })`

async function expectBuildError(files: Record<string, string>, pattern: RegExp) {
  const dir = await theme(files)
  const err = await build({ cwd: dir, quiet: true }).catch((e) => e)
  expect(err).toBeInstanceOf(BuildError)
  expect(String(err.message)).toMatch(pattern)
}

describe('21. build validation', () => {
  it('builds a valid theme and computes analysis', async () => {
    const dir = await theme({
      'blocks/a.tsx': block(`defineBlock({
        fields: { n: { type: 'number' }, s: { type: 'slot' } },
        data: { q: find('posts', { limit: { $prop: 'n' }, where: { title: { contains: { $query: 'q' } } } }) },
        render: (p) => <div><Slot name="s" /></div>,
      })`),
    })
    const { manifest } = await build({ cwd: dir, quiet: true })
    expect(manifest.blocks.a).toMatchObject({ propRefs: { q: ['n'] }, usesRequestParams: true, slots: ['s'] })
    expect(Object.keys(manifest.files)).toContain('bundle.js')
  })

  it('rejects function-valued field options', async () => {
    await expectBuildError(
      { 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'array', arrayFields: { x: { type: 'text' } }, getItemSummary: (i) => i.x } }, render: () => null } as any)`) },
      /function-valued field options/,
    )
    await expectBuildError(
      { 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'select', options: [{ label: 'a', value: () => 1 }] } }, render: () => null } as any)`) },
      /options\[0\]/,
    )
  })

  it('rejects external and custom fields', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'external', fetchList: async () => [] } }, render: () => null } as any)`) }, /"external" is not supported/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'custom', render: () => null } }, render: () => null } as any)`) }, /"custom" is not supported/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'richtext' } }, render: () => null } as any)`) }, /unsupported field type/)
  })

  it('rejects permissions, resolvePermissions, resolveFields and resolveData', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, permissions: { delete: false }, render: () => null } as any)`) }, /"permissions" is not supported/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, resolvePermissions: () => ({}), render: () => null } as any)`) }, /"resolvePermissions"/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, resolveFields: () => ({}), render: () => null } as any)`) }, /use declarative visibleIf/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, resolveData: async () => ({}), render: () => null } as any)`) }, /declare queries in `data`/)
  })

  it('rejects non-serializable metadata', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { when: new Date() }, render: () => null } as any)`) }, /non-plain object \(Date\)/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { m: new Map() }, render: () => null } as any)`) }, /non-plain object \(Map\)/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { n: NaN }, render: () => null } as any)`) }, /non-finite/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { f: () => 1 }, render: () => null } as any)`) }, /function values are not allowed/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, label: Symbol('x'), render: () => null } as any)`) }, /label: must be a string/)
  })

  it('rejects expression-string visibleIf, unknown refs and secrets outside headers', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { a: { type: 'text', visibleIf: 'b === 1' } }, render: () => null } as any)`) }, /visibleIf must be an object/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { a: { type: 'text' } }, data: { q: find('posts', { limit: { $prop: 'nope' } }) }, render: () => null } as any)`) }, /\$prop "nope" is not a field/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, data: { q: find('posts', { where: { t: { equals: { $secret: 'K' } } } }) }, render: () => null } as any)`) }, /\$secret is only allowed/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, data: { q: find('posts', { where: { t: { regex: '.*' } } }) }, render: () => null } as any)`) }, /unsupported operator/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, data: { q: { source: 'sql', query: 'select 1' } }, render: () => null } as any)`) }, /query must be built with/)
  })

  it('a valid block next to an invalid one still fails the whole build', async () => {
    await expectBuildError({ 'blocks/good.tsx': block(ok), 'blocks/bad.tsx': block(`defineBlock({ fields: { x: { type: 'external' } }, render: () => null } as any)`) }, /blocks\/bad/)
  })
})

describe('templates and the browser bundle', () => {
  const page = (content: unknown[]) => JSON.stringify({ root: { props: {} }, content })
  const slotted = block(`defineBlock({ fields: { title: { type: 'text' }, s: { type: 'slot' } }, render: (p) => <div>{p.title}<Slot name="s" /></div> })`)

  it('ships theme templates in the artifact, listed in manifest.files', async () => {
    const dir = await theme({
      'blocks/a.tsx': slotted,
      'templates/home.json': page([{ type: 'a', props: { id: '1', s: [{ type: 'a', props: { id: '2' } }] } }]),
      'templates/blog/post-1.json': page([]),
    })
    const { manifest, outDir } = await build({ cwd: dir, quiet: true })
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['templates/home.json', 'templates/blog/post-1.json', 'bundle.browser.js']))
    expect(JSON.parse(await readFile(path.join(outDir, 'templates', 'home.json'), 'utf8')).content[0].type).toBe('a')
  })

  it('fails on a page using a block the theme does not have (also inside slots)', async () => {
    await expectBuildError({ 'blocks/a.tsx': slotted, 'templates/home.json': page([{ type: 'gone', props: { id: '1' } }]) }, /templates\/home.json content\[0\]: unknown block "gone"/)
    await expectBuildError(
      { 'blocks/a.tsx': slotted, 'templates/home.json': page([{ type: 'a', props: { id: '1', s: [{ type: 'gone', props: {} }] } }]) },
      /content\[0\]\.props\.s\[0\]: unknown block "gone"/,
    )
  })

  it('fails on invalid page files', async () => {
    await expectBuildError({ 'blocks/a.tsx': slotted, 'templates/Home.json': page([]) }, /templates\/<name>\.json/)
    await expectBuildError({ 'blocks/a.tsx': slotted, 'templates/home.json': '{ nope' }, /invalid JSON/)
    await expectBuildError({ 'blocks/a.tsx': slotted, 'templates/home.json': '{"content": []}' }, /must be Puck data/)
  })

  it('the browser bundle has no bare imports: React and the SDK come from the editor globals', async () => {
    const dir = await theme({ 'blocks/a.tsx': slotted })
    const { outDir } = await build({ cwd: dir, quiet: true })
    const file = path.join(outDir, 'bundle.browser.js')
    const src = await readFile(file, 'utf8')
    expect([...src.matchAll(/(?:from|import)\s*"([^"]+)"/g)]).toEqual([])
    for (const spec of ['react/jsx-runtime', '@puck-remote/sdk']) expect(src).toContain(`${BROWSER_MODULES_GLOBAL}?.[${JSON.stringify(spec)}]`)
    // Without the editor's globals it refuses to load; with them it exports the blocks.
    await expect(import(`${pathToFileURL(file).href}?missing`)).rejects.toThrow(/is not provided by the page/)
    const g = globalThis as Record<string, unknown>
    g[BROWSER_MODULES_GLOBAL] = Object.fromEntries(
      await Promise.all(BROWSER_EXTERNALS.map(async (spec) => [spec, await import(spec)])),
    )
    try {
      const mod = await import(`${pathToFileURL(file).href}?ok`)
      expect(Object.keys(mod.default.blocks)).toEqual(['a'])
    } finally {
      delete g[BROWSER_MODULES_GLOBAL]
    }
  })
})

describe('islands ("use client" modules)', () => {
  const counter = `'use client'
import { useState } from 'react'
export function Counter({ start = 0 }) { const [n, setN] = useState(start); return <button onClick={() => setN(n + 1)}>{n}</button> }
export const STEP = 1
`
  const plain = `export function Label() { return <span>label</span> }\n`
  const usesBoth = block(`defineBlock({ fields: {}, render: () => <div><Counter start={2} /><Label /></div> })`).replace(
    "from '@puck-remote/sdk'",
    "from '@puck-remote/sdk'\nimport { Counter } from './parts/counter'\nimport { Label } from './parts/label'",
  )

  it('wraps function exports in the isolate and editor bundles and emits an islands-only bundle', async () => {
    const dir = await theme({ 'blocks/a.tsx': usesBoth, 'blocks/parts/counter.tsx': counter, 'blocks/parts/label.tsx': plain })
    const { outDir, manifest } = await build({ cwd: dir, quiet: true })
    expect(manifest.files['bundle.islands.js']).toMatch(/^[0-9a-f]{64}$/)
    for (const f of ['bundle.js', 'bundle.browser.js']) {
      const src = await readFile(path.join(outDir, f), 'utf8')
      expect(src).toContain('"blocks/parts/counter.tsx#Counter"')
      expect(src).not.toContain('blocks/parts/label.tsx#')
    }
    const file = path.join(outDir, 'bundle.islands.js')
    const src = await readFile(file, 'utf8')
    expect([...src.matchAll(/(?:from|import)\s*"([^"]+)"/g)]).toEqual([])
    expect(src).not.toContain('label')
    const g = globalThis as Record<string, unknown>
    g[BROWSER_MODULES_GLOBAL] = Object.fromEntries(await Promise.all(BROWSER_EXTERNALS.map(async (spec) => [spec, await import(spec)])))
    try {
      const mod = await import(pathToFileURL(file).href)
      // Only function exports, keyed by "<path>#<export>"; the islands bundle holds the originals.
      expect(Object.keys(mod.default)).toEqual(['blocks/parts/counter.tsx#Counter'])
      expect(mod.default['blocks/parts/counter.tsx#Counter'].displayName).toBeUndefined() // not island()-wrapped
    } finally {
      delete g[BROWSER_MODULES_GLOBAL]
    }
  })

  it('emits no islands bundle without "use client" modules', async () => {
    const dir = await theme({ 'blocks/a.tsx': simpleBlock() })
    const { manifest } = await build({ cwd: dir, quiet: true })
    expect(manifest.files['bundle.islands.js']).toBeUndefined()
  })
})

describe('package', () => {
  /** Entries of a .tar.gz: path → content. */
  async function untar(bytes: Uint8Array): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    const parser = new Parser()
    parser.on('entry', (e) => {
      const chunks: Buffer[] = []
      e.on('data', (c: Buffer) => chunks.push(c))
      e.on('end', () => (out[e.path] = Buffer.concat(chunks).toString('utf8')))
    })
    await new Promise<void>((resolve) => {
      parser.on('close', () => resolve())
      parser.end(Buffer.from(bytes))
    })
    return out
  }

  it('packs every dist file at the archive root, long paths included', async () => {
    const deep = 'templates/' + Array.from({ length: 5 }, (_, i) => `${'s'.repeat(60)}${i}`).join('/') + '.json'
    const dir = await theme({ 'blocks/a.tsx': simpleBlock(), [deep]: JSON.stringify({ root: { props: {} }, content: [] }) })
    const { outDir, manifest } = await build({ cwd: dir, quiet: true })
    const files = await untar(await packDist(outDir))
    expect(Object.keys(files).sort()).toEqual(['manifest.json', ...Object.keys(manifest.files)].sort())
    expect(deep.length).toBeGreaterThan(100)
    expect(JSON.parse(files[deep])).toEqual({ root: { props: {} }, content: [] })
  })

  it('writes <name>-<bundle hash>.tar.gz by default', async () => {
    const dir = await theme({ 'blocks/a.tsx': simpleBlock(), 'package.json': JSON.stringify({ name: '@acme/shop-theme' }) })
    const { outDir, manifest } = await build({ cwd: dir, quiet: true })
    const { file } = await writePackage({ distDir: outDir, cwd: dir, quiet: true })
    expect(path.basename(file)).toBe(`acme-shop-theme-${manifest.files['bundle.js'].slice(0, 12)}.tar.gz`)
    await expect(packDist(path.join(dir, 'missing'))).rejects.toThrow(/run "puck-remote build" first/)
  })
})

describe('themes (CLI side)', () => {
  it('names dev and share themes after the device, within 50 characters', () => {
    expect(generateThemeName('Development', 'benjamins-macbook.local')).toMatch(/^Development \([0-9a-f]{6}-benjamins-macbook\)$/)
    expect(generateThemeName('Share', 'my host_name')).toMatch(/^Share \([0-9a-f]{6}-my-host-name\)$/)
    const long = generateThemeName('Development', 'x'.repeat(100))
    expect(long.length).toBeLessThanOrEqual(50)
    expect(long).toMatch(/^Development \([0-9a-f]{6}-x+\)$/)
  })

  it('resolves --theme by id first, then by a unique name', () => {
    const t = (id: string, name: string) => ({ id, name, role: 'unpublished' as const, artifact: 'a', createdAt: '', updatedAt: '' })
    const themes = [t('aaaaaaaaaaaa', 'Summer'), t('bbbbbbbbbbbb', 'Winter'), t('cccccccccccc', 'Winter'), t('dddddddddddd', 'aaaaaaaaaaaa')]
    expect(resolveTheme(themes, 'aaaaaaaaaaaa').id).toBe('aaaaaaaaaaaa')
    expect(resolveTheme(themes, 'Summer').id).toBe('aaaaaaaaaaaa')
    expect(() => resolveTheme(themes, 'Winter')).toThrow(/several themes are named "Winter"/)
    expect(() => resolveTheme(themes, 'Spring')).toThrow(/no theme "Spring"/)
  })

  it('remembers the device dev theme per API URL', async () => {
    const file = path.join(await theme({}), 'cfg', 'dev-themes.json')
    expect(apiKey('HTTP://Admin.Example.com/api/themes/')).toBe('http://admin.example.com/api/themes')
    expect(await getDevTheme('http://a.test/api', file)).toBeNull()
    await setDevTheme('http://a.test/api/', 'aaaaaaaaaaaa', file)
    await setDevTheme('http://b.test/api', 'bbbbbbbbbbbb', file)
    expect(await getDevTheme('http://A.test/api', file)).toBe('aaaaaaaaaaaa')
    await setDevTheme('http://a.test/api', null, file)
    expect(await getDevTheme('http://a.test/api', file)).toBeNull()
    expect(await getDevTheme('http://b.test/api', file)).toBe('bbbbbbbbbbbb')
  })
})

describe('partial pushes', () => {
  it('upload what is new or changed (plus the manifest); report what the theme no longer has', () => {
    const remote = { 'bundle.js': 'a', 'assets/big.png': 'b', 'templates/home.json': 'c', 'assets/old.css': 'd' }
    const local = { 'bundle.js': 'a2', 'assets/big.png': 'b', 'templates/home.json': 'c', 'assets/new.css': 'e' }
    expect(diffManifests(local, remote)).toEqual({ upload: ['assets/new.css', 'bundle.js', 'manifest.json'], removed: ['assets/old.css'] })
    expect(diffManifests(local, null)).toEqual({ upload: [...Object.keys(local).sort(), 'manifest.json'], removed: [] })
    expect(diffManifests(remote, remote)).toEqual({ upload: ['manifest.json'], removed: [] })
  })
})

describe('CLI config file', () => {
  it('loads puck-remote.cli.ts first, then .mts, .js, .mjs; --config overrides; none gives {}', async () => {
    const dir = await theme({})
    expect(await loadCliConfig({ cwd: dir })).toEqual({})
    await writeFile(path.join(dir, 'puck-remote.cli.mjs'), "export default { url: 'http://mjs.test/api' }\n")
    expect((await loadCliConfig({ cwd: dir })).url).toBe('http://mjs.test/api')
    await writeFile(path.join(dir, 'puck-remote.cli.js'), "export default { url: 'http://js.test/api' }\n")
    expect((await loadCliConfig({ cwd: dir })).url).toBe('http://js.test/api')
    await writeFile(
      path.join(dir, 'puck-remote.cli.ts'),
      "import type { CliConfig } from '@puck-remote/cli/config'\nconst config: CliConfig = { url: 'http://ts.test/api', headers: () => ({ 'x-api-key': process.env.TEST_KEY ?? 'none' }) }\nexport default config\n",
    )
    const ts = await loadCliConfig({ cwd: dir })
    expect(ts.url).toBe('http://ts.test/api')
    expect(await (ts.headers as () => Promise<Record<string, string>>)()).toEqual({ 'x-api-key': 'none' })
    expect((await loadCliConfig({ cwd: dir, file: 'puck-remote.cli.mjs' })).url).toBe('http://mjs.test/api')
    await expect(loadCliConfig({ cwd: dir, file: 'missing.ts' })).rejects.toThrow(/no config file at/)
    await writeFile(path.join(dir, 'bad.mjs'), 'export default 42\n')
    await expect(loadCliConfig({ cwd: dir, file: 'bad.mjs' })).rejects.toThrow(/must export a config object/)
  })
})

function simpleBlock() {
  return block(`defineBlock({ fields: { title: { type: 'text' } }, render: (p) => <div>{p.title}</div> })`)
}
