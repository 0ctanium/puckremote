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
import { createCore, type PuckRemoteCore } from '../src/index.ts'
import { buildExample, REPO_ROOT } from './helpers.ts'

let core: PuckRemoteCore
let dir: string
const req = (p: string, init?: RequestInit) => new Request(`http://host.test${p}`, init)

beforeAll(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-routes-'))
  await publish({ distDir: (await buildExample()).outDir, artifactsDir: path.join(dir, 'artifacts'), quiet: true })
  core = createCore({
    id: `routes-${process.pid}`,
    artifactsDir: path.join(dir, 'artifacts'),
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

  it('handleTheme serves bundle.js and assets under the configured prefix only', async () => {
    const b = await core.handleTheme(req('/_remote/theme/v1/bundle.js'))
    expect(b.status).toBe(200)
    expect(b.headers.get('content-type')).toContain('javascript')
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
    expect((await core.handleTheme(req('/_remote/theme/v1/bundle.js', { method: 'POST' }))).status).toBe(405)
  })

  it('handleApi dispatches pages / blocks/resolve / artifact/reload with method checks', async () => {
    const page = { root: { props: { title: 'R' } }, content: [{ type: 'card', props: { id: 'c1', title: 'Routed', __data: { leak: true } } }] }
    const saved = await core.handleApi(req('/_remote/api/pages', { method: 'POST', body: JSON.stringify({ slug: 'routed', data: page }) }))
    expect(saved.status).toBe(200)
    const got = await (await core.handleApi(req('/_remote/api/pages?slug=routed'))).json()
    expect(JSON.stringify(got)).not.toContain('__data')

    const r = await core.handleApi(req('/_remote/api/blocks/resolve', { method: 'POST', body: JSON.stringify({ blockType: 'latest-posts', props: { count: 1 } }) }))
    expect(r.status).toBe(200)
    expect((await r.json()).data.posts.ok).toBe(true)

    expect((await core.handleApi(req('/_remote/api/artifact/reload', { method: 'POST' }))).status).toBe(200)
    expect((await core.handleApi(req('/_remote/api/blocks/resolve'))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/artifact/reload'))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/pages', { method: 'DELETE' }))).status).toBe(405)
    expect((await core.handleApi(req('/_remote/api/nope'))).status).toBe(404)
    expect((await core.handleApi(req('/_remote/api/pages', { method: 'POST', body: 'not json' }))).status).toBe(400)
  })

  it('preparePage and loadEditor use the configured routes', async () => {
    const page = (await core.preparePage('routed', {}, { locale: 'fr' }))!
    expect(page.head.styles).toEqual(['/_remote/theme/v1/assets/theme.css']) // custom prefix flows into ctx.assetUrl
    expect(page.rendered.c1.html).toContain('Routed')
    expect(await core.preparePage('missing')).toBeNull()
    const editor = await core.loadEditor('routed')
    expect(editor.routes).toEqual({ api: '/_remote/api', theme: '/_remote/theme', editor: '/editor' })
    expect(editor.version).toBe(1)
  })
})
