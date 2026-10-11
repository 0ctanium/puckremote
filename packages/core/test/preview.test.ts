/**
 * Preview of non-main themes: signed tokens, the preview route and its cookie, rendering a theme,
 * and the LRU of preview runtimes.
 */
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { mockCms } from '@puck-remote/source-mock'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCore, type PuckRemoteCore } from '../src/core.ts'
import { ArtifactLoader } from '../src/server/artifact-loader.ts'
import { resolveConfig } from '../src/server/config.ts'
import { ArtifactRuntimes } from '../src/server/preview-runtimes.ts'
import { createPreviewToken, handlePreview, previewCookieValue, verifyPreviewToken } from '../src/server/preview.ts'
import { inProcessRenderer } from '../src/server/runtime/in-process.ts'
import { reloadOrigin } from '../src/shared/preview-cookie.ts'
import { PuckRemoteTemplate } from '../src/react/PuckRemoteTemplate.tsx'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { buildEvil, buildExample, publish, quietLog, REPO_ROOT, withPages } from './helpers.ts'

const PREVIEW = { secret: 's3cret', ttlSeconds: 60 }
const template = (title: string) => ({ root: { props: { title } }, content: [] })

describe('preview tokens', () => {
  it('round-trips the theme id until expiry', () => {
    const t = createPreviewToken(PREVIEW, '0123456789ab', 1_000_000)
    expect(verifyPreviewToken(PREVIEW, t, 1_000_000)).toEqual({ theme: '0123456789ab', exp: 1000 + 60 })
    expect(verifyPreviewToken(PREVIEW, t, 1_059_999)?.theme).toBe('0123456789ab')
    expect(verifyPreviewToken(PREVIEW, t, 1_060_000)).toBeNull()
  })

  it('rejects tampered, foreign and malformed tokens', () => {
    const t = createPreviewToken(PREVIEW, '0123456789ab')
    const [payload, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ t: 'ba9876543210', exp: 9e9 })).toString('base64url')
    for (const bad of [`${forged}.${mac}`, `${payload}.${mac.slice(1)}x`, createPreviewToken({ ...PREVIEW, secret: 'other' }, '0123456789ab'), '', 'a.b.c', null, 42, 'x'.repeat(600)])
      expect(verifyPreviewToken(PREVIEW, bad), String(bad)).toBeNull()
    expect(() => createPreviewToken(PREVIEW, '../main')).toThrow(/invalid theme id/)
  })

  it('reads the cookie out of a Cookie header', () => {
    expect(previewCookieValue('a=1; puck_remote_preview=tok.en; b=2')).toBe('tok.en')
    expect(previewCookieValue('a=1')).toBeNull()
    expect(previewCookieValue(null)).toBeNull()
  })
})

describe('preview route', () => {
  const config = resolveConfig({ artifacts: {} as never, source: {} as never, preview: PREVIEW })
  const get = (q: string) => handlePreview(config, new Request(`https://www.example.com/theme/preview${q}`))

  it('a valid token sets an HttpOnly cookie and redirects home; ?exit clears it', () => {
    const token = createPreviewToken(PREVIEW, '0123456789ab')
    const res = get(`?token=${token}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.getSetCookie()[0]).toMatch(new RegExp(`^puck_remote_preview=${token.replace('.', '\\.')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=(59|60)$`))
    expect(get('?exit').headers.getSetCookie()[0]).toBe('puck_remote_preview=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
  })

  it('refuses invalid tokens, other methods, and answers 404 without preview config', async () => {
    const bad = get('?token=nope')
    expect(bad.status).toBe(400)
    expect(await bad.text()).toBe('Invalid or expired preview link')
    expect(handlePreview(config, new Request('https://www.example.com/theme/preview', { method: 'POST' })).status).toBe(405)
    const off = resolveConfig({ artifacts: {} as never, source: {} as never })
    expect(handlePreview(off, new Request('https://www.example.com/theme/preview?exit')).status).toBe(404)
  })
})

describe('live reload (puck-remote dev)', () => {
  const config = resolveConfig({ artifacts: {} as never, source: {} as never, preview: PREVIEW })
  const cookies = (r: Response) => r.headers.getSetCookie()

  it('accepts only http loopback origins with a port', () => {
    expect(reloadOrigin('http://127.0.0.1:9293')).toBe('http://127.0.0.1:9293')
    expect(reloadOrigin('http://localhost:9293/')).toBe('http://localhost:9293')
    expect(reloadOrigin('http://[::1]:9293')).toBe('http://[::1]:9293')
    for (const bad of ['https://127.0.0.1:9293', 'http://127.0.0.1', 'http://evil.test:9293', 'http://127.0.0.1:9293/x', 'http://u:p@127.0.0.1:9293', 'http://127.0.0.1:9293?x', 'javascript:alert(1)', '', null, 42])
      expect(reloadOrigin(bad), String(bad)).toBeNull()
  })

  it('the preview route keeps a loopback reload URL in a second cookie, and clears it otherwise', () => {
    const token = createPreviewToken(PREVIEW, '0123456789ab')
    const get = (q: string) => handlePreview(config, new Request(`https://www.example.com/theme/preview${q}`))
    const ok = cookies(get(`?token=${token}&reload=${encodeURIComponent('http://127.0.0.1:9293')}`))
    expect(ok[0]).toMatch(/^puck_remote_preview=/)
    expect(ok[1]).toMatch(/^puck_remote_reload=http%3A%2F%2F127\.0\.0\.1%3A9293; Path=\/; HttpOnly; SameSite=Lax; Max-Age=(59|60)$/)
    expect(cookies(get(`?token=${token}&reload=${encodeURIComponent('http://evil.test:80')}`))[1]).toMatch(/^puck_remote_reload=; .*Max-Age=0$/)
    expect(cookies(get(`?token=${token}`))[1]).toMatch(/^puck_remote_reload=; .*Max-Age=0$/)
    expect(cookies(get('?exit'))).toEqual([
      'puck_remote_preview=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      'puck_remote_reload=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    ])
  })
})

describe('rendering a theme', () => {
  let core: PuckRemoteCore
  let live: string
  let dev: string
  let devTheme: string
  beforeAll(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'puck-remote-preview-')), 'artifacts')
    const built = (await buildExample()).outDir
    live = (await publish({ distDir: await withPages(built, { home: template('Live') }), artifacts: dir })).id
    ;({ id: dev, theme: devTheme } = await publish({ distDir: await withPages(built, { home: template('Dev'), extra: template('Only dev') }), artifacts: dir, role: 'development' }))
    core = createCore({
      id: `preview-${process.pid}`,
      artifacts: fsArtifactStore({ dir }),
      source: mockCms({ dataFile: path.join(REPO_ROOT, 'examples', 'app', 'data', 'cms.json') }),
      renderer: inProcessRenderer(),
      origins: { host: ['https://admin.test'], editor: 'https://editor.test', site: 'https://www.test' },
      preview: PREVIEW,
      themes: { multiple: true },
    })
  })
  afterAll(async () => {
    const h = await core.host()
    h.store.close()
    h.previews.close()
  })

  it('prepareTemplate renders the theme, marks it as a preview and never cacheable', async () => {
    const p = await core.prepareTemplate('home')
    expect(`${p?.theme.id}-${p?.theme.hash}`).toBe(live)
    expect(p?.data.root.props?.title).toBe('Live')
    expect(p?.preview).toBeUndefined()
    const d = await core.prepareTemplate('home', { theme: devTheme })
    expect(`${d?.theme.id}-${d?.theme.hash}`).toBe(dev)
    expect(d?.data.root.props?.title).toBe('Dev')
    expect(d?.preview).toEqual({ theme: { id: devTheme, name: 'Theme 2', role: 'development' } })
    expect(d?.cacheable).toBe(false)
    expect(await core.prepareTemplate('extra')).toBeNull()
    expect((await core.prepareTemplate('extra', { theme: devTheme }))?.data.root.props?.title).toBe('Only dev')
  })

  it('a preview carries the reload origin (only with a theme) and the template renders the nonced script', async () => {
    const d = await core.prepareTemplate('home', { theme: devTheme, reload: 'http://127.0.0.1:9293' })
    expect(d?.preview?.reload).toBe('http://127.0.0.1:9293')
    expect((await core.prepareTemplate('home', { theme: devTheme, reload: 'http://evil.test:1' }))?.preview?.reload).toBeUndefined()
    expect((await core.prepareTemplate('home', { reload: 'http://127.0.0.1:9293' }))?.preview).toBeUndefined()
    const html = renderToString(createElement(PuckRemoteTemplate, { template: { ...d!, scriptNonce: 'n0nce' } }))
    expect(html).toContain('<script nonce="n0nce">new EventSource("http://127.0.0.1:9293/events")')
    expect(html).toContain("addEventListener('reload',function(){location.reload()})")
    const plain = renderToString(createElement(PuckRemoteTemplate, { template: (await core.prepareTemplate('home'))! }))
    expect(plain).not.toContain('EventSource')
  })

  it('an unknown or invalid theme behaves like an unknown template', async () => {
    expect(await core.prepareTemplate('home', { theme: 'aaaaaaaaaaaa' })).toBeNull()
    expect(await core.prepareTemplate('home', { theme: '../main' })).toBeNull()
    expect(await core.readTemplate('home', { theme: 'aaaaaaaaaaaa' })).toBeNull()
  })

  it('readTemplate and editorPayload follow the theme', async () => {
    const r = await core.readTemplate('home', { theme: devTheme })
    expect(`${r?.theme}-${r?.hash}`).toBe(dev)
    const payload = await core.editorPayload('home', { theme: devTheme })
    expect(`${payload.theme}-${payload.hash}`).toBe(dev)
    // The editor protocol's origins are strict: origins.site never reaches it.
    expect(payload.origins).toEqual({ host: ['https://admin.test'], editor: 'https://editor.test' })
    await expect(core.editorPayload('home', { theme: 'aaaaaaaaaaaa' })).rejects.toThrow(/unknown theme aaaaaaaaaaaa/)
  })

  it('preview links and cookies', () => {
    expect(core.createPreviewUrl({ id: devTheme, role: 'main' })).toBeNull()
    const url = core.createPreviewUrl({ id: devTheme, role: 'development' })!
    expect(url).toMatch(/^https:\/\/www\.test\/theme\/preview\?token=/)
    expect(core.previewTheme(new URL(url).searchParams.get('token'))).toBe(devTheme)
    expect(core.previewTheme('forged.token')).toBeNull()
    expect(core.previewTheme(undefined)).toBeNull()
  })
})

describe('preview runtimes LRU', () => {
  async function setup(max: number, idleMs = 60_000) {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'puck-remote-lru-')), 'artifacts')
    const artifacts = fsArtifactStore({ dir })
    const ex = (await buildExample()).outDir
    const pubs = [
      await publish({ distDir: ex, artifacts }),
      await publish({ distDir: (await buildEvil()).outDir, artifacts, role: 'unpublished' }),
      await publish({ distDir: await withPages(ex, { home: template('b') }), artifacts, role: 'unpublished' }),
      await publish({ distDir: await withPages(ex, { home: template('c') }), artifacts, role: 'unpublished' }),
    ]
    const ids = pubs.map((p) => p.id)
    const ref = (i: number) => ({ id: pubs[i].theme, hash: pubs[i].hash })
    const disposed: string[] = []
    const createRuntime = ({ id }: { id: string }) => ({ id, dispose: () => void disposed.push(id) })
    const live = new ArtifactLoader({ artifacts, createRuntime, log: quietLog })
    await live.reload()
    const lru = new ArtifactRuntimes({ live, createRuntime, max, idleMs, log: quietLog })
    return { ids, ref, lru, disposed, live }
  }

  it('serves the live artifact itself, caches others and evicts the least recently used', async () => {
    const { ids, ref, lru, disposed, live } = await setup(2)
    const [, a, b, c] = ids
    expect(await lru.get(ref(0))).toBe(live.get())
    expect(lru.size).toBe(0)
    await lru.get(ref(1))
    await lru.get(ref(2))
    await lru.get(ref(1)) // a is now the most recent
    await lru.get(ref(3))
    expect(lru.size).toBe(2)
    await vi.waitFor(() => expect(disposed).toEqual([b]))
    expect((await lru.get(ref(1))).id).toBe(a)
    lru.close()
    await vi.waitFor(() => expect(disposed.sort()).toEqual([a, b, c].sort()))
  })

  it('disposes runtimes idle for idleMs, and does not cache failed loads', async () => {
    const { ids, ref, lru, disposed } = await setup(3, 50)
    await lru.get(ref(1))
    await vi.waitFor(() => expect(disposed).toEqual([ids[1]]), { timeout: 2000 })
    expect(lru.size).toBe(0)
    await expect(lru.get({ id: 'ffffffffffff', hash: 'f'.repeat(64) })).rejects.toThrow(/has no files/)
    expect(lru.size).toBe(0)
  })
})
