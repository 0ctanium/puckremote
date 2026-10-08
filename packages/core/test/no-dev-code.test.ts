/**
 * Acceptance 7: nothing in the host imports or evaluates developer code outside the isolate.
 *
 * Static check over every host source file (src/, next.config, proxy) plus a runtime check that
 * rendering a page never installs the bundle's globals in the host realm.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = path.resolve(import.meta.dirname, '../../..')
const ORIGINAL = { TextEncoder: globalThis.TextEncoder, MessageChannel: globalThis.MessageChannel }

/** Every host-side root: the engine, the Next bindings and the app. */
const ROOTS = {
  core: ['packages/core/src'],
  next: ['packages/next/src'],
  app: ['apps/host/src', 'apps/host/puck-remote.config.ts', 'apps/host/next.config.ts'],
} as const

async function sources(p: string): Promise<string[]> {
  const abs = path.join(REPO, p)
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(p)) return [abs]
  const out: string[] = []
  for (const e of await readdir(abs, { withFileTypes: true })) {
    const rel = path.join(p, e.name)
    if (e.isDirectory()) out.push(...(await sources(rel)))
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(path.join(REPO, rel))
  }
  return out
}

type Rule = [RegExp, string]
const EVERYWHERE: Rule[] = [
  [/from\s+['"][^'"]*(examples|artifacts)\//, 'imports from examples/ or artifacts/'],
  [/from\s+['"]@puck-remote\/cli(\/[^'"]*)?['"]/, 'imports the CLI'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/['"](node:)?vm['"]/, 'node:vm'],
  [/\bcreateRequire\b/, 'createRequire'],
  [/\bimportScripts\b/, 'importScripts'],
]
const PER_ROOT: Record<keyof typeof ROOTS, Rule[]> = {
  // Engine + bindings: only the trusted contracts from the SDK; never a concrete plugin.
  core: [
    [/from\s+['"]@puck-remote\/sdk(\/(?!host['"])[^'"]*)?['"]/, 'imports the theme-facing SDK (only @puck-remote/sdk/host allowed)'],
    [/from\s+['"]@puck-remote\/(source-|artifacts-|next|editor)[^'"]*['"]/, 'imports a plugin, framework binding or the editor'],
    [/from\s+['"]next(\/[^'"]*)?['"]/, 'imports next (core must stay framework-agnostic)'],
  ],
  next: [
    [/from\s+['"]@puck-remote\/sdk[^'"]*['"]/, 'imports the SDK directly'],
    [/from\s+['"]@puck-remote\/(source-|artifacts-)[^'"]*['"]/, 'imports a concrete plugin'],
    [/(from|import)\s+['"]isolated-vm['"]/, 'imports isolated-vm (only the core may)'],
  ],
  // The app wires plugins (puck-remote.config.ts only) and uses the bindings; no SDK, no engine internals.
  app: [
    [/from\s+['"]@puck-remote\/sdk[^'"]*['"]/, 'imports the SDK'],
    [/from\s+['"]@puck-remote\/core\/(?!config['"])[^'"]*['"]/, 'imports @puck-remote/core internals'],
    [/(from|import)\s+['"]isolated-vm['"]/, 'imports isolated-vm'],
  ],
}

// Where the isolate bundle may legitimately flow: compiled in an isolate, in-process or in a
// sandboxed worker. It is never served to browsers (the editor app loads bundle.browser.js, on
// its own credential-free origin).
const BUNDLE_SINKS: Record<string, RegExp> = {
  'packages/core/src/server/runtime/in-process.ts': /compileScriptSync\(this\.bundle/,
  // Worker pool: the bundle goes over IPC to a sandboxed worker, which compiles it in an isolate.
  'packages/core/src/server/runtime/worker-pool.ts': /request\(\{ t: 'load', version, bundle, limits \}\)/,
  'packages/core/src/server/runtime/render-worker.ts': /new IsolateRunner\(m\.bundle, m\.limits/,
  'packages/core/src/server/host.ts': /renderer\(\{ id, bundle, limits/,
}
const BUNDLE_READERS = new Set([
  'packages/core/src/server/artifact-loader.ts', // reads + hash-verifies bytes, never evaluates
  'packages/core/src/server/static-files.ts', // generic byte server
  'packages/core/src/server/manifest-schema.ts', // asserts bundle.js is listed in files
  'packages/core/src/server/pages.ts', // copies every file's bytes into a new artifact, never evaluates
])

// Browser-only modules: their code runs only in effects (never during SSR), where loading the
// theme's islands bundle is the point (D-0243). Only these two rules are lifted, and the only
// theme-facing SDK import allowed is @puck-remote/sdk/browser.
const BROWSER_ONLY: Record<string, string[]> = {
  'packages/core/src/react/ThemeIsland.tsx': ['dynamic import()', 'imports the theme-facing SDK (only @puck-remote/sdk/host allowed)'],
}

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')

describe('acceptance 7: no developer code outside the isolate', () => {
  it('host sources contain no forbidden loading/evaluation patterns', async () => {
    const violations: string[] = []
    for (const [root, paths] of Object.entries(ROOTS) as [keyof typeof ROOTS, readonly string[]][]) {
      for (const p of paths) {
        for (const f of await sources(p)) {
          const rel = path.relative(REPO, f)
          const src = strip(await readFile(f, 'utf8'))
          const rules = [...EVERYWHERE, ...PER_ROOT[root]]
          for (const [re, what] of rules) {
            // The worker pool resolves isolated-vm's location (never developer code) to build the
            // worker's filesystem allowlist.
            if (rel === 'packages/core/src/server/runtime/worker-pool.ts' && what === 'createRequire') continue
            if (BROWSER_ONLY[rel]?.includes(what)) continue
            if (re.test(src)) violations.push(`${rel}: ${what}`)
          }
          if (BROWSER_ONLY[rel]) {
            const sdk = [...src.matchAll(/from\s+['"](@puck-remote\/sdk[^'"]*)['"]/g)].map((m) => m[1])
            if (sdk.some((s) => s !== '@puck-remote/sdk/browser')) violations.push(`${rel}: browser-only modules may only import @puck-remote/sdk/browser`)
            if ((src.match(/\bimport\s*\(/g) ?? []).length !== 1) violations.push(`${rel}: exactly one dynamic import() (the islands bundle)`)
          }
          if (root === 'app' && rel !== 'apps/host/puck-remote.config.ts' && /from\s+['"]@puck-remote\/(source-|artifacts-)/.test(src)) {
            violations.push(`${rel}: concrete plugins may only be wired in puck-remote.config.ts`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('bundle.js only flows to the isolate compiler (in-process or worker); never to browsers', async () => {
    const all = (await Promise.all(Object.values(ROOTS).flat().map(sources))).flat()
    for (const f of all) {
      const rel = path.relative(REPO, f)
      const src = strip(await readFile(f, 'utf8'))
      if (!/bundle\.js|\.bundle\b|\bbundle\)|themeBundleUrl|compileScript/.test(src) || BUNDLE_READERS.has(rel)) continue
      if (rel.startsWith('apps/host/') || rel === 'packages/next/src/index.ts') {
        // The app and the barrels only reference the bundle loader by name, never the file.
        expect(src, rel).not.toMatch(/bundle\.js|compileScript/)
        continue
      }
      expect(Object.keys(BUNDLE_SINKS), `unexpected bundle sink in ${rel}`).toContain(rel)
      expect(src).toMatch(BUNDLE_SINKS[rel])
    }
  })

  it('rendering a page never installs bundle globals in the host realm', async () => {
    const { testHost } = await import('./helpers.ts')
    const { preparePage } = await import('../src/server/public-render.ts')
    const h = await testHost({ theme: 'evil', pages: { home: { root: { props: {} }, content: [{ type: 'polluter', props: { id: 'p' } }, { type: 'probe', props: { id: 'q' } }] } } })
    await preparePage(h.host, 'home', {})
    const g = globalThis as Record<string, unknown>
    expect(g.__render).toBeUndefined()
    expect(g.__toRequest).toBeUndefined()
    expect(g.__leak).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    // The isolate shims never replaced the host's own globals.
    expect(globalThis.MessageChannel).toBe(ORIGINAL.MessageChannel)
    expect(globalThis.TextEncoder).toBe(ORIGINAL.TextEncoder)
    await h.close()
  })
})
