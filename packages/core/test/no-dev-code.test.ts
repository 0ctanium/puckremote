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
    [/from\s+['"]@puck-remote\/(source-|pages-|next)[^'"]*['"]/, 'imports a plugin or framework binding'],
    [/from\s+['"]next(\/[^'"]*)?['"]/, 'imports next (core must stay framework-agnostic)'],
  ],
  next: [
    [/from\s+['"]@puck-remote\/sdk[^'"]*['"]/, 'imports the SDK directly'],
    [/from\s+['"]@puck-remote\/(source-|pages-)[^'"]*['"]/, 'imports a concrete plugin'],
    [/(from|import)\s+['"]isolated-vm['"]/, 'imports isolated-vm (only the core may)'],
  ],
  // The app wires plugins (puck-remote.config.ts only) and uses the bindings; no SDK, no engine internals.
  app: [
    [/from\s+['"]@puck-remote\/sdk[^'"]*['"]/, 'imports the SDK'],
    [/from\s+['"]@puck-remote\/core\/(?!config['"])[^'"]*['"]/, 'imports @puck-remote/core internals'],
    [/(from|import)\s+['"]isolated-vm['"]/, 'imports isolated-vm'],
  ],
}

// Where the bundle may legitimately flow: compiled in the isolate, or served to the editor as bytes.
const BUNDLE_SINKS: Record<string, RegExp> = {
  'packages/core/src/server/isolate-runner.ts': /compileScriptSync\(this\.bundle/,
  'packages/core/src/server/host.ts': /new IsolateRunner\(bundle/,
  'packages/core/src/core.ts': /readArtifactFile\(config\.artifactsDir, version, rel\)/, // served as bytes
  'packages/core/src/shared/urls.ts': /\/bundle\.js`/, // URL builder
  // Browser-side only (editor realm, documented same-origin gap): never runs on the server.
  'packages/core/src/editor/bundle-frame.ts': /srcdoc = `<!doctype html><script src=/,
  'packages/core/src/editor/EditorClient.tsx': /^'use client'[\s\S]*loadBundle\(version, themeBundleUrl/,
}
const BUNDLE_READERS = new Set([
  'packages/core/src/server/artifact-loader.ts', // reads + hash-verifies bytes, never evaluates
  'packages/core/src/server/static-files.ts', // generic byte server
  'packages/core/src/server/manifest-schema.ts', // asserts bundle.js is listed in files
])

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
            if (re.test(src)) violations.push(`${rel}: ${what}`)
          }
          if (root === 'app' && rel !== 'apps/host/puck-remote.config.ts' && /from\s+['"]@puck-remote\/(source-|pages-)/.test(src)) {
            violations.push(`${rel}: concrete plugins may only be wired in puck-remote.config.ts`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('bundle.js only flows to the isolate compiler or is served as static bytes', async () => {
    const all = (await Promise.all(Object.values(ROOTS).flat().map(sources))).flat()
    for (const f of all) {
      const rel = path.relative(REPO, f)
      const src = strip(await readFile(f, 'utf8'))
      if (!/bundle\.js|\.bundle\b|\bbundle\)|themeBundleUrl|compileScript/.test(src) || BUNDLE_READERS.has(rel)) continue
      if (rel.startsWith('apps/host/') || rel === 'packages/core/src/editor/index.ts' || rel === 'packages/next/src/index.ts') {
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
