/**
 * The framework-agnostic entry points (createCore → handleApi / handleTheme / preparePage /
 * loadEditor), exercised with plain fetch Requests, exactly as any framework binding calls them.
 */
import { publish } from '@puck-remote/cli'
import { fsPageStore } from '@puck-remote/pages-fs'
import { mockCms } from '@puck-remote/source-mock'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { createCore, devAllowAll, resolveConfig, type PuckRemoteCore } from '../src/index.ts'
import { buildExample, REPO_ROOT } from './helpers.ts'

let core: PuckRemoteCore
let dir: string
const req = (p: string, init?: RequestInit) => new Request(`http://host.test${p}`, init)
/** A mutating request as the editor sends it (CSRF header, same origin). */
const post = (p: string, body?: unknown) =>
  req(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-puck-remote': '1', origin: 'http://host.test' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })

beforeAll(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-routes-'))
  await publish({ distDir: (await buildExample()).outDir, artifacts: path.join(dir, 'artifacts'), quiet: true })
  core = createCore({
    id: `routes-${process.pid}`,
    artifacts: fsArtifactStore({ dir: path.join(dir, 'artifacts') }),
    auth: devAllowAll(),
    source: mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') }),
    pages: fsPageStore({ dir: path.join(dir, 'pages') }),
    routes: { api: '/_remote/api', theme: '/_remote/theme' },
  })
})
afterAll(async () => (await core.host()).store.close())

describe('createCore', () => {
  it('is memoized per config id (one runtime shared by all route bundles)', () => {
    expect(createCore({ id: `routes-${process.pid}` } as never)).toBe(core)
  })

  it('handleTheme serves assets under the configured prefix only, and never the theme bundle', async () => {
    // The bundle is theme CODE: it only ever runs server-side (isolate / worker), never in browsers.
    expect((await core.handleTheme(req('/_remote/theme/v1/bundle.js'))).status).toBe(404)
    const css = await core.handleTheme(req('/_remote/theme/v1/assets/theme.css'))
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
    for (const p of [
      '/_remote/theme/v1/manifest.json',
      '/_remote/theme/v1/assets/../manifest.json',
      '/_remote/theme/v1/assets/%2e%2e/manifest.json',
      '/_remote/theme/v0/bundle.js',
      '/_remote/theme/v9/bundle.js',
      '/theme/v1/bundle.js',
    ]) {
      expect((await core.handleTheme(req(p))).status, p).toBe(404)
    }
    expect((await core.handleTheme(req('/_remote/theme/v1/assets/theme.css', { method: 'POST' }))).status).toBe(405)
  })

  it('handleApi dispatches pages / blocks/resolve / artifact/reload with method checks', async () => {
    const page = { root: { props: { title: 'R' } }, content: [{ type: 'card', props: { id: 'c1', title: 'Routed', __data: { leak: true } } }] }
    const saved = await core.handleApi(post('/_remote/api/pages/save', { slug: 'routed', data: page, baseRevision: null }))
    expect(saved.status).toBe(200)
    const { meta } = await saved.json()
    const got = await (await core.handleApi(req('/_remote/api/pages?slug=routed'))).json()
    expect(got.meta).toEqual(meta)
    expect(got.draft.data.content[0].props.title).toBe('Routed')
    expect(JSON.stringify(got)).not.toContain('__data')
    expect((await core.handleApi(post('/_remote/api/pages/publish', { slug: 'routed', revision: meta.draftRevision }))).status).toBe(200)

    const r = await core.handleApi(post('/_remote/api/blocks/resolve', { blockType: 'latest-posts', props: { count: 1 } }))
    expect(r.status).toBe(200)
    expect((await r.json()).data.posts.ok).toBe(true)

    expect((await core.handleApi(post('/_remote/api/artifact/reload'))).status).toBe(200)
    expect((await core.handleApi(req('/_remote/api/blocks/resolve'))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/artifact/reload'))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/pages', { method: 'DELETE' }))).status).toBe(405)
    expect((await core.handleApi(post('/_remote/api/pages'))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/pages/save'))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/nope'))).status).toBe(404)
    expect((await core.handleApi(post('/_remote/api/pages/save', 'not json'))).status).toBe(400)
    expect((await core.handleApi(post('/_remote/api/pages/save', { slug: 'routed', data: page }))).status).toBe(400) // baseRevision is required
    expect((await core.handleApi(post('/_remote/api/pages/save', { slug: 'Bad Slug', data: page, baseRevision: null }))).status).toBe(400)
  })

  it('publishing workflow: drafts, conflicts, publish, history, restore, unpublish, delete', async () => {
    const api = (p: string) => `/_remote/api/${p}`
    const page = (title: string) => ({ root: { props: {} }, content: [{ type: 'card', props: { id: 'w1', title } }] })
    const save = async (title: string, baseRevision: string | null) => core.handleApi(post(api('pages/save'), { slug: 'flow', data: page(title), baseRevision }))

    const a = await (await save('One', null)).json()
    expect(a.meta).toMatchObject({ slug: 'flow', publishedRevision: null })
    expect(await core.preparePage('flow')).toBeNull() // nothing published yet
    const conflict = await save('Again', null)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: 'conflict', meta: { draftRevision: a.meta.draftRevision } })

    expect((await core.handleApi(post(api('pages/publish'), { slug: 'flow', revision: a.meta.draftRevision }))).status).toBe(200)
    const b = await (await save('Two', a.meta.draftRevision)).json()
    expect((await save('Lost', a.meta.draftRevision)).status).toBe(409)
    // The site serves the published revision; the editor opens the draft.
    expect((await core.preparePage('flow'))!.rendered.w1.html).toContain('One')
    const editor = await core.loadEditor('flow', req('/editor/flow'))
    expect(editor.page).toMatchObject({ draftRevision: b.meta.draftRevision, publishedRevision: a.meta.draftRevision })
    expect(JSON.stringify(editor.initialData)).toContain('Two')
    // Publishing a revision that is no longer the draft is a conflict.
    expect((await core.handleApi(post(api('pages/publish'), { slug: 'flow', revision: a.meta.draftRevision }))).status).toBe(409)

    const hist = await (await core.handleApi(req(api('pages/history?slug=flow&limit=1')))).json()
    expect(hist.revisions.map((r: { revision: string }) => r.revision)).toEqual([b.meta.draftRevision])
    const older = await (await core.handleApi(req(api(`pages/history?slug=flow&before=${b.meta.draftRevision}`)))).json()
    expect(older.revisions.map((r: { revision: string }) => r.revision)).toEqual([a.meta.draftRevision])
    for (const q of ['limit=0', 'limit=101', 'limit=x', 'limit=1.5']) expect((await core.handleApi(req(api(`pages/history?slug=flow&${q}`)))).status, q).toBe(400)
    const one = await (await core.handleApi(req(api(`pages/revision?slug=flow&revision=${a.meta.draftRevision}`)))).json()
    expect(one.data.content[0].props.title).toBe('One')
    expect((await core.handleApi(req(api('pages/revision?slug=flow&revision=99999999')))).status).toBe(404)

    // Restore = the old revision saved as a new draft (stale base → 409).
    expect((await core.handleApi(post(api('pages/restore'), { slug: 'flow', revision: a.meta.draftRevision, baseRevision: a.meta.draftRevision }))).status).toBe(409)
    const restored = await (await core.handleApi(post(api('pages/restore'), { slug: 'flow', revision: a.meta.draftRevision, baseRevision: b.meta.draftRevision }))).json()
    expect(restored.meta.draftRevision).not.toBe(b.meta.draftRevision)
    expect((await (await core.handleApi(req(api('pages?slug=flow')))).json()).draft.data.content[0].props.title).toBe('One')

    const un = await core.handleApi(post(api('pages/unpublish'), { slug: 'flow' }))
    expect((await un.json()).meta.publishedRevision).toBeNull()
    expect(await core.preparePage('flow')).toBeNull()
    expect((await core.handleApi(post(api('pages/delete'), { slug: 'flow' }))).status).toBe(200)
    expect((await core.handleApi(req(api('pages?slug=flow')))).status).toBe(404)
    expect((await core.handleApi(post(api('pages/unpublish'), { slug: 'flow' }))).status).toBe(404)
  })

  it('preparePage and loadEditor use the configured routes', async () => {
    const page = (await core.preparePage('routed', {}, { locale: 'fr' }))!
    expect(page.head.styles).toEqual(['/_remote/theme/v1/assets/theme.css']) // custom prefix flows into ctx.assetUrl
    expect(page.rendered.c1.html).toContain('Routed')
    expect(await core.preparePage('missing')).toBeNull()
    const editor = await core.loadEditor('routed', req('/editor/routed'))
    expect(editor.routes).toEqual({ api: '/_remote/api', theme: '/_remote/theme', editor: '/editor' })
    expect(editor.version).toBe(1)
  })
})

describe('preview links', () => {
  const SECRET = 'x'.repeat(32)
  let pc: PuckRemoteCore
  beforeAll(() => {
    pc = createCore({ ...core.config, id: `preview-${process.pid}`, auth: devAllowAll(), preview: { secret: SECRET } })
  })
  afterAll(async () => (await pc.host()).store.close())
  const api = (p: string) => `/_remote/api/${p}`

  it('signs a draft revision; the site renders it with draft data, hides the token from $query, 404 otherwise', async () => {
    const page = { root: { props: {} }, content: [{ type: 'card', props: { id: 'p1', title: 'Secret draft' } }] }
    const saved = await (await pc.handleApi(post(api('pages/save'), { slug: 'blog/preview', data: page, baseRevision: null }))).json()
    const res = await pc.handleApi(post(api('pages/preview-link'), { slug: 'blog/preview', revision: saved.meta.draftRevision }))
    expect(res.status).toBe(200)
    const { url, expiresAt } = await res.json()
    expect(url).toMatch(/^\/blog\/preview\?puck_preview=/)
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(23 * 3600_000)
    const token = new URL(url, 'http://x').searchParams.get('puck_preview')!

    expect(await pc.preparePage('blog/preview')).toBeNull() // not published
    const shown = (await pc.preparePage('blog/preview', { puck_preview: token }, { preview: token }))!
    expect(shown.rendered.p1.html).toContain('Secret draft')
    expect(shown).toMatchObject({ preview: true, cacheable: false })
    // Draft data mode: unpublished CMS docs are visible in a preview.
    const withData = await (await pc.handleApi(post(api('pages/save'), {
      slug: 'blog/preview', baseRevision: saved.meta.draftRevision,
      data: { root: { props: {} }, content: [{ type: 'search-results', props: { id: 's1' } }] },
    }))).json()
    const link2 = await (await pc.handleApi(post(api('pages/preview-link'), { slug: 'blog/preview', revision: withData.meta.draftRevision }))).json()
    const t2 = new URL(link2.url, 'http://x').searchParams.get('puck_preview')!
    const q = await pc.preparePage('blog/preview', { puck_preview: t2, q: 'DRAFT' }, { preview: t2 })
    expect(q!.rendered.s1.html).toContain('DRAFT: Unannounced feature')

    // Other slug, tampered, expired, garbage, feature off → 404.
    expect(await pc.preparePage('home', {}, { preview: token })).toBeNull()
    const [payload, sig] = token.split('.')
    expect(await pc.preparePage('blog/preview', {}, { preview: `${payload}.${sig.slice(0, -2)}AA` })).toBeNull()
    expect(await pc.preparePage('blog/preview', {}, { preview: 'nope' })).toBeNull()
    const { createPreviewToken } = await import('../src/server/preview.ts')
    const old = await createPreviewToken(SECRET, { slug: 'blog/preview', revision: saved.meta.draftRevision, ttlSeconds: 60, now: Date.now() - 120_000 })
    expect(await pc.preparePage('blog/preview', {}, { preview: old.token })).toBeNull()
    const other = await createPreviewToken('y'.repeat(32), { slug: 'blog/preview', revision: saved.meta.draftRevision, ttlSeconds: 60 })
    expect(await pc.preparePage('blog/preview', {}, { preview: other.token })).toBeNull()
    expect(await core.preparePage('blog/preview', {}, { preview: token })).toBeNull() // core without preview config

    expect((await core.handleApi(post(api('pages/preview-link'), { slug: 'blog/preview', revision: saved.meta.draftRevision }))).status).toBe(404)
    expect((await pc.handleApi(post(api('pages/preview-link'), { slug: 'blog/preview', revision: '99999999' }))).status).toBe(404)
    expect((await pc.loadEditor('home', req('/editor'))).previewEnabled).toBe(true)
    expect((await core.loadEditor('home', req('/editor'))).previewEnabled).toBe(false)
  })

  it('validates the preview config', () => {
    const denyAll = { authenticate: async () => null, authorize: () => false }
    expect(() => resolveConfig({ ...core.config, auth: denyAll, preview: { secret: SECRET, ttlSeconds: 59 } })).toThrow(/between 60 and 2592000/)
    expect(() => resolveConfig({ ...core.config, auth: denyAll, preview: { secret: SECRET, ttlSeconds: 2592001 } })).toThrow(/between 60 and 2592000/)
    const env = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      expect(() => resolveConfig({ ...core.config, auth: denyAll, allowSharedOrigin: true, preview: { secret: 'short' } })).toThrow(/at least 32 bytes in production/)
      expect(resolveConfig({ ...core.config, auth: denyAll, allowSharedOrigin: true, preview: { secret: SECRET } }).preview).toEqual({ secret: SECRET, ttlSeconds: 86400 })
    } finally {
      process.env.NODE_ENV = env
    }
  })
})
