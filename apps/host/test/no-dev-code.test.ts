/**
 * Acceptance 7: nothing in the host imports or evaluates developer code outside the isolate.
 *
 * Static check over every host source file (src/, next.config, proxy) plus a runtime check that
 * rendering a page never installs the bundle's globals in the host realm.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const HOST = path.resolve(import.meta.dirname, '..')
const ORIGINAL = { TextEncoder: globalThis.TextEncoder, MessageChannel: globalThis.MessageChannel }

async function sources(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await sources(p)))
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"][^'"]*(examples|artifacts)\//, 'imports from examples/ or artifacts/'],
  [/from\s+['"]@poc\/(sdk|cli)(\/[^'"]*)?['"]/, 'imports developer-facing SDK/CLI at runtime'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/['"](node:)?vm['"]/, 'node:vm'],
  [/\bcreateRequire\b/, 'createRequire'],
  [/\bimportScripts\b/, 'importScripts'],
]

// Where the bundle may legitimately flow: compiled in the isolate, or served to the editor as bytes.
const BUNDLE_SINKS: Record<string, RegExp> = {
  'src/server/isolate-runner.ts': /compileScriptSync\(this\.bundle/,
  'src/server/host.ts': /new IsolateRunner\(bundle/,
  'src/app/theme-bundle/[version]/route.ts': /readArtifactFile\(.*'bundle\.js'\)/,
  // Browser-side only (editor realm, documented same-origin gap): never runs on the server.
  'src/editor/bundle-frame.ts': /theme-bundle\/v/,
  'src/editor/EditorClient.tsx': /^'use client'[\s\S]*loadBundle\(version\)/,
}

describe('acceptance 7: no developer code outside the isolate', () => {
  it('host sources contain no forbidden loading/evaluation patterns', async () => {
    const files = [...(await sources(path.join(HOST, 'src'))), path.join(HOST, 'next.config.ts')]
    const violations: string[] = []
    for (const f of files) {
      const src = (await readFile(f, 'utf8')).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
      for (const [re, what] of FORBIDDEN) if (re.test(src)) violations.push(`${path.relative(HOST, f)}: ${what}`)
    }
    expect(violations).toEqual([])
  })

  it('bundle.js only flows to the isolate compiler or is served as static bytes', async () => {
    const files = await sources(path.join(HOST, 'src'))
    const touching: string[] = []
    for (const f of files) {
      const rel = path.relative(HOST, f)
      const src = await readFile(f, 'utf8')
      if (/bundle\.js|\.bundle\b|\bbundle\)|theme-bundle|compileScript/.test(src)) touching.push(rel)
    }
    for (const rel of touching) {
      if (rel === 'src/server/artifact-loader.ts') continue // reads + hash-verifies bytes, never evaluates
      if (rel === 'src/server/static-files.ts') continue // generic byte server
      if (rel === 'src/proxy.ts') continue // matcher string only
      if (rel === 'src/server/manifest-schema.ts') continue // asserts bundle.js is listed in files
      expect(Object.keys(BUNDLE_SINKS), `unexpected bundle sink in ${rel}`).toContain(rel)
      expect(await readFile(path.join(HOST, rel), 'utf8')).toMatch(BUNDLE_SINKS[rel])
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
