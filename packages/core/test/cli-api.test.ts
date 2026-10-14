/**
 * The CLI against a real artifacts API over HTTP (a node:http server wrapping the core handler and
 * an fs store): push, publish, pull, list, rename, duplicate, delete, share, and `dev` from two
 * devices; a single-theme site.
 */
import {
  build,
  deleteDevTheme,
  deleteTheme,
  dev,
  duplicateTheme,
  getDevTheme,
  listThemes,
  publish,
  pull,
  push,
  renameTheme,
  share,
  startReloadServer,
  writePackage,
} from '@puck-remote/cli'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleArtifactsApi } from '../src/server/artifacts-api.ts'
import { resolveConfig } from '../src/server/config.ts'
import { themeOps } from '../src/server/themes.ts'

// The CLI sends no auth of its own: the host here wants an API key header, set by the config.
const KEY = 'test-key'
// Under this package so the fixture themes resolve @puck-remote/sdk and react.
const FIXTURES = path.join(import.meta.dirname, '.fixtures')
const servers: Server[] = []

async function host(multiple: boolean) {
  const artifacts = fsArtifactStore({ dir: path.join(await mkdtemp(path.join(os.tmpdir(), 'puck-remote-cli-api-')), 'artifacts') })
  const config = resolveConfig({
    artifacts,
    source: {} as never,
    origins: { host: ['http://127.0.0.1'], editor: 'http://editor.test', site: 'http://site.test' },
    preview: { secret: 'x' },
    themes: { multiple },
  })
  const themes = themeOps(config)
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    })
    const sub = req.url!.replace(/^\/api\/themes\/?/, '').split('?')[0]
    const response = await handleArtifactsApi(config, themes, sub, request, {
      authorize: (r) => r.headers.get('x-api-key') === KEY,
    })
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/themes`
  return { artifacts, api: { url, headers: { 'x-api-key': KEY } } }
}

afterAll(async () => {
  for (const s of servers) s.close()
  await rm(FIXTURES, { recursive: true, force: true })
})

async function theme(title: string) {
  await mkdir(FIXTURES, { recursive: true })
  const dir = await mkdtemp(path.join(FIXTURES, 't-'))
  await mkdir(path.join(dir, 'blocks'), { recursive: true })
  await mkdir(path.join(dir, 'templates'), { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  await writeFile(path.join(dir, 'blocks', 'hero.tsx'), heroBlock(title))
  await writeFile(path.join(dir, 'templates', 'home.json'), JSON.stringify({ root: { props: {} }, content: [] }))
  return dir
}
const heroBlock = (title: string) =>
  `import { defineBlock } from '@puck-remote/sdk'\nexport default defineBlock({ fields: {}, render: () => <h1>${title}</h1> })\n`
const quiet = { log() {}, error() {} }

describe('CLI over the artifacts API (several themes)', () => {
  let site: Awaited<ReturnType<typeof host>>
  beforeAll(async () => {
    site = await host(true)
  })
  const bundle = async (theme: string) => new TextDecoder().decode((await site.artifacts.readFile(theme, 'bundle.js'))!)

  it('push --live creates the main theme; --unpublished, publish, pull, rename, duplicate, delete, share', async () => {
    const dir = await theme('One')
    const { outDir } = await build({ cwd: dir, quiet: true })
    await expect(push({ api: site.api, distDir: outDir, quiet: true })).rejects.toThrow(/several themes: choose one with --theme/)
    const main = await push({ api: site.api, distDir: outDir, live: true, packageName: 'fixture', quiet: true })
    expect(main.theme).toMatchObject({ name: 'fixture', role: 'main' })
    expect(main.previewUrl).toBeUndefined()
    // Pushing the same build again sends only the manifest.
    expect((await push({ api: site.api, distDir: outDir, live: true, quiet: true })).sent).toEqual(['manifest.json'])

    await writeFile(path.join(dir, 'blocks', 'hero.tsx'), heroBlock('Two'))
    const { outDir: out2 } = await build({ cwd: dir, quiet: true })
    const { file } = await writePackage({ distDir: out2, cwd: dir, quiet: true })
    const draft = await push({ api: site.api, file, unpublished: true, name: 'Summer', quiet: true })
    expect(draft.theme).toMatchObject({ name: 'Summer', role: 'unpublished' })
    expect(draft.previewUrl).toMatch(/^http:\/\/site\.test\/theme\/preview\?token=/)
    expect(await bundle(draft.theme.id)).toContain('Two')

    // --theme by name updates that theme.
    expect((await push({ api: site.api, theme: 'fixture', distDir: out2, quiet: true })).theme.id).toBe(main.theme.id)
    expect(await bundle(main.theme.id)).toContain('Two')

    const target = await theme('unused')
    await rm(path.join(target, 'templates'), { recursive: true })
    expect(await pull({ cwd: target, api: site.api, theme: 'Summer', quiet: true })).toEqual({ theme: draft.theme.id, templates: ['templates/home.json'] })
    expect(JSON.parse(await readFile(path.join(target, 'templates', 'home.json'), 'utf8'))).toEqual({ root: { props: {} }, content: [] })
    expect((await pull({ cwd: target, api: site.api, quiet: true })).theme).toBe(main.theme.id)
    await expect(pull({ cwd: target, api: site.api, theme: 'Nope', quiet: true })).rejects.toThrow(/no theme "Nope"/)

    expect((await publish(site.api, 'Summer', { quiet: true })).theme.role).toBe('main')
    expect((await listThemes(site.api, { role: 'unpublished' })).map((t) => t.name)).toEqual(['fixture'])
    expect((await renameTheme(site.api, 'fixture', 'Winter')).theme.name).toBe('Winter')
    const copy = await duplicateTheme(site.api, 'Winter')
    expect(copy.theme).toMatchObject({ name: 'Copy of Winter', role: 'unpublished' })
    await deleteTheme(site.api, copy.theme.id)
    await expect(deleteTheme(site.api, 'Summer')).rejects.toMatchObject({ status: 400 })

    const shared = await share({ api: site.api, distDir: out2, quiet: true })
    expect(shared.theme.name).toMatch(/^Share \([0-9a-f]{6}-/)
    expect(shared.previewUrl).toMatch(/preview\?token=/)
  })

  it('dev sends only what changed: bundles for a block, the asset for an asset, the template for a template', async () => {
    const dir = await theme('Diff v1')
    await mkdir(path.join(dir, 'assets'), { recursive: true })
    await writeFile(path.join(dir, 'assets', 'big.css'), 'a{}'.repeat(1000))
    const cfg = path.join(await mkdtemp(path.join(os.tmpdir(), 'puck-remote-devcfg-')), 'dev-themes.json')
    const logs: string[] = []
    const d = await dev({ cwd: dir, api: site.api, devThemesFile: cfg, debounceMs: 50, log: { log: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }, reload: false })
    const next = async (change: () => Promise<void>) => {
      const n = logs.length
      await change()
      await expect.poll(() => logs.slice(n).find((l) => l.includes('→')), { timeout: 10_000, interval: 50 }).toBeTruthy()
      return logs.slice(n).find((l) => l.includes('→'))!
    }
    try {
      expect(logs.find((l) => l.includes('→'))).toMatch(/→ \d+ files/) // first push: everything
      expect(await next(() => writeFile(path.join(dir, 'assets', 'big.css'), 'b{}'))).toMatch(/→ 1 file \(assets\/big\.css\)$/)
      expect(await next(() => writeFile(path.join(dir, 'templates', 'home.json'), JSON.stringify({ root: { props: { title: 'x' } }, content: [] })))).toMatch(
        /→ 1 file \(templates\/home\.json\)$/,
      )
      const block = await next(() => writeFile(path.join(dir, 'blocks', 'hero.tsx'), heroBlock('Diff v2')))
      expect(block).toContain('bundle.js')
      expect(block).not.toContain('assets/big.css')
      expect(block).not.toContain('templates/home.json')
      expect(await next(() => rm(path.join(dir, 'assets', 'big.css')))).toMatch(/no file changed, 1 removed$/)
    } finally {
      await d.close()
    }
  }, 30_000)

  it('API errors surface with their status and message', async () => {
    await expect(listThemes({ url: site.api.url, headers: { 'x-api-key': 'wrong' } })).rejects.toMatchObject({ status: 401, message: 'GET /: 401 unauthorized' })
    await expect(listThemes({ url: site.api.url })).rejects.toMatchObject({ status: 401 })
    await expect(listThemes({ url: '' })).rejects.toThrow('the artifacts API URL is required (--url, PUCK_REMOTE_URL or url in puck-remote.cli.ts)')
  })

  it('headers may be a function (called per request) and fetch takes over sending', async () => {
    let calls = 0
    expect(await listThemes({ url: site.api.url, headers: async () => (calls++, { 'x-api-key': KEY }) })).toBeInstanceOf(Array)
    expect(calls).toBe(1)
    const seen: string[] = []
    const viaFetch = await listThemes({
      url: site.api.url,
      headers: { 'x-trace': 'abc' },
      fetch: async (req) => {
        seen.push(`${req.method} ${new URL(req.url).pathname} ${req.headers.get('x-trace')}`)
        const signed = new Request(req, { headers: new Headers([...req.headers, ['x-api-key', KEY]]) })
        return fetch(signed)
      },
    })
    expect(viaFetch).toBeInstanceOf(Array)
    expect(seen).toEqual(['GET /api/themes abc'])
  })

  it('dev: one development theme per device, remembered, recreated when gone', async () => {
    const a = await theme('Alice v1')
    const b = await theme('Bob v1')
    const cfg = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-devcfg-'))
    const fileA = path.join(cfg, 'a', 'dev-themes.json')
    const fileB = path.join(cfg, 'b', 'dev-themes.json')
    const da = await dev({ cwd: a, api: site.api, devThemesFile: fileA, hostname: 'alice-mac.local', debounceMs: 50, log: quiet, reload: false })
    const db = await dev({ cwd: b, api: site.api, devThemesFile: fileB, hostname: 'bob-pc', debounceMs: 50, log: quiet, reload: false })
    const themeOf = async (id: string) => (await listThemes(site.api)).find((t) => t.id === id)!
    try {
      expect(da.theme.name).toMatch(/^Development \([0-9a-f]{6}-alice-mac\)$/)
      expect(db.theme.name).toMatch(/^Development \([0-9a-f]{6}-bob-pc\)$/)
      expect(da.previewUrl).toMatch(/preview\?token=/)
      expect(await getDevTheme(site.api.url, fileA)).toBe(da.theme.id)
      expect((await themeOf(da.theme.id)).role).toBe('development')

      await writeFile(path.join(a, 'blocks', 'hero.tsx'), heroBlock('Alice v2'))
      await expect.poll(async () => bundle(da.theme.id), { timeout: 10_000, interval: 100 }).toContain('Alice v2')
      expect(await bundle(db.theme.id)).toContain('Bob v1')

      // A build error keeps the theme on its last good version.
      const before = (await themeOf(db.theme.id)).hash
      await writeFile(path.join(b, 'blocks', 'hero.tsx'), 'export default 1 +')
      await new Promise((r) => setTimeout(r, 1000))
      expect((await themeOf(db.theme.id)).hash).toBe(before)
    } finally {
      await da.close()
      await db.close()
    }

    // The same device reuses its theme; once it is gone, a new one is created and remembered.
    const again = await dev({ cwd: a, api: site.api, devThemesFile: fileA, hostname: 'alice-mac', log: quiet, reload: false })
    await again.close()
    expect(again.theme.id).toBe(da.theme.id)
    expect(await deleteDevTheme(site.api, { devThemesFile: fileA })).toBe(da.theme.id)
    expect(await getDevTheme(site.api.url, fileA)).toBeNull()
    const fresh = await dev({ cwd: a, api: site.api, devThemesFile: fileA, hostname: 'alice-mac', log: quiet, reload: false })
    await fresh.close()
    expect(fresh.theme.id).not.toBe(da.theme.id)
    expect(await getDevTheme(site.api.url, fileA)).toBe(fresh.theme.id)
  }, 30_000)
})

describe('CLI over the artifacts API (single theme)', () => {
  it('push goes to the main theme without flags; dev is refused', async () => {
    const site = await host(false)
    const dir = await theme('Solo')
    const { outDir } = await build({ cwd: dir, quiet: true })
    const first = await push({ api: site.api, distDir: outDir, packageName: 'solo', quiet: true })
    expect(first.theme).toMatchObject({ name: 'solo', role: 'main' })
    expect((await push({ api: site.api, distDir: outDir, quiet: true })).theme.id).toBe(first.theme.id)
    await expect(push({ api: site.api, distDir: outDir, unpublished: true, quiet: true })).rejects.toThrow(/single theme/)
    const cfg = path.join(await mkdtemp(path.join(os.tmpdir(), 'puck-remote-devcfg-')), 'dev-themes.json')
    await expect(dev({ cwd: dir, api: site.api, devThemesFile: cfg, log: quiet, reload: false })).rejects.toThrow('this site has a single theme (themes.multiple is false)')
  })
})

describe('dev live reload (SSE)', () => {
  /** Reads SSE events from a server until `count` reload events arrived. */
  async function events(url: string, count: number, during: () => Promise<void>) {
    const res = await fetch(`${url}/events`)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const reader = res.body!.getReader()
    const got: unknown[] = []
    let buf = ''
    const reading = (async () => {
      while (got.length < count) {
        const { value, done } = await reader.read()
        if (done) break
        buf += new TextDecoder().decode(value)
        for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const data = block.split('\n').find((l) => l.startsWith('data: '))
          if (block.includes('event: reload') && data) got.push(JSON.parse(data.slice(6)))
        }
      }
    })()
    await during()
    await Promise.race([reading, new Promise((r) => setTimeout(r, 10_000))])
    await reader.cancel()
    return got
  }

  it('pages get a reload event after each push; the preview link carries the server URL', async () => {
    const site = await host(true)
    const dir = await theme('Live v1')
    const cfg = path.join(await mkdtemp(path.join(os.tmpdir(), 'puck-remote-devcfg-')), 'dev-themes.json')
    const d = await dev({ cwd: dir, api: site.api, devThemesFile: cfg, debounceMs: 50, log: quiet, reload: { port: 19293 } })
    try {
      expect(d.reloadUrl).toBe('http://127.0.0.1:19293')
      expect(d.previewUrl).toMatch(/&reload=http%3A%2F%2F127\.0\.0\.1%3A19293$/)
      const got = await events(d.reloadUrl!, 1, () => writeFile(path.join(dir, 'blocks', 'hero.tsx'), heroBlock('Live v2')))
      expect(got).toEqual([{ theme: d.theme.id, hash: expect.stringMatching(/^[0-9a-f]{64}$/) }])
      expect((await fetch(`${d.reloadUrl}/other`)).status).toBe(404)
    } finally {
      await d.close()
    }
  }, 30_000)

  it('a busy port falls back to the next one', async () => {
    const busy = await startReloadServer({ port: 19400 })
    const next = await startReloadServer({ port: 19400 })
    try {
      expect(busy.port).toBe(19400)
      expect(next.port).toBe(19401)
    } finally {
      await busy.close()
      await next.close()
    }
  })
})
