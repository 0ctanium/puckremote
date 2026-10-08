/**
 * Origins and surfaces: the editor (and its API) only on editor origins, the public site only on
 * site origins, theme assets on both. Production refuses a shared origin.
 */
import { publish } from '@puck-remote/cli'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { fsPageStore } from '@puck-remote/pages-fs'
import { mockCms } from '@puck-remote/source-mock'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCore, devAllowAll, WrongSurfaceError, type PuckRemoteCore } from '../src/index.ts'
import { DEFAULT_ROUTES, resolveConfig } from '../src/server/config.ts'
import { inProcessRenderer } from '../src/server/runtime/in-process.ts'
import { classifyRequest } from '../src/server/surface.ts'
import { buildExample, quietLog, REPO_ROOT } from './helpers.ts'

const SITE = 'https://www.example.test'
const EDITOR = 'https://admin.example.test'
const OTHER = 'https://evil.test'
const origins = { site: [SITE], editor: [EDITOR] }

describe('classifyRequest', () => {
  const table: [string, string, boolean][] = [
    // [origin, path, allowed]
    [SITE, '/', true],
    [SITE, '/about', true],
    [SITE, '/editor', false],
    [SITE, '/editor/about', false],
    [SITE, '/api/pages', false],
    [SITE, '/theme/v1/assets/theme.css', true],
    [EDITOR, '/', false],
    [EDITOR, '/about', false],
    [EDITOR, '/editor', true],
    [EDITOR, '/api/blocks/render', true],
    [EDITOR, '/theme/v1/assets/theme.css', true],
    [OTHER, '/', false],
    [OTHER, '/editor', false],
    [OTHER, '/api/pages', false],
    [OTHER, '/theme/v1/assets/theme.css', false],
  ]
  it.each(table)('%s%s → allowed=%s', (origin, p, allowed) => {
    expect(classifyRequest(new Request(origin + p), { routes: DEFAULT_ROUTES, origins }).allowed).toBe(allowed)
  })
  it('without origins (development) every surface is served everywhere', () => {
    expect(classifyRequest(new Request(OTHER + '/editor'), { routes: DEFAULT_ROUTES, origins: null }).allowed).toBe(true)
  })
})

describe('core entry points enforce surfaces', () => {
  let core: PuckRemoteCore
  beforeAll(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-surface-'))
    await publish({ distDir: (await buildExample()).outDir, artifacts: path.join(dir, 'artifacts'), quiet: true })
    const pagesDir = path.join(dir, 'pages')
    const pages = fsPageStore({ dir: pagesDir })
    await pages.put('home', { root: { props: {} }, content: [{ type: 'card', props: { id: 'c', title: 'Hello' } }] })
    core = createCore({
      id: `surface-${process.pid}`,
      artifacts: fsArtifactStore({ dir: path.join(dir, 'artifacts') }),
      source: mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') }),
      pages,
      auth: devAllowAll(),
      renderer: inProcessRenderer({ log: quietLog }),
      origins,
    })
  })
  afterAll(async () => (await core.host()).store.close())

  const post = (origin: string, p: string, body: unknown) =>
    new Request(origin + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-puck-remote': '1', origin }, body: JSON.stringify(body) })

  it('API: only on the editor origin (404 elsewhere)', async () => {
    const render = { slug: 'home', items: [{ key: 'a', kind: 'block', name: 'card', props: { title: 'x' }, data: {} }] }
    expect((await core.handleApi(post(EDITOR, '/api/blocks/render', render))).status).toBe(200)
    expect((await core.handleApi(post(SITE, '/api/blocks/render', render))).status).toBe(404)
    expect((await core.handleApi(new Request(SITE + '/api/pages?slug=home'))).status).toBe(404)
  })

  it('editor: loadEditor refuses non-editor origins', async () => {
    expect((await core.loadEditor('home', new Request(EDITOR + '/editor'))).slug).toBe('home')
    await expect(core.loadEditor('home', new Request(SITE + '/editor'))).rejects.toBeInstanceOf(WrongSurfaceError)
  })

  it('public pages: only on site origins when the request is known', async () => {
    expect(await core.preparePage('home', {}, { request: new Request(SITE + '/') })).not.toBeNull()
    expect(await core.preparePage('home', {}, { request: new Request(EDITOR + '/') })).toBeNull()
  })

  it('theme assets: on both, never elsewhere', async () => {
    expect((await core.handleTheme(new Request(SITE + '/theme/v1/assets/theme.css'))).status).toBe(200)
    expect((await core.handleTheme(new Request(EDITOR + '/theme/v1/assets/theme.css'))).status).toBe(200)
    expect((await core.handleTheme(new Request(OTHER + '/theme/v1/assets/theme.css'))).status).toBe(404)
  })

  it('CSRF allowlist defaults to the editor origins', () => {
    expect(core.config.allowedOrigins).toContain(EDITOR)
  })
})

describe('production guard', () => {
  const base = { artifacts: fsArtifactStore({ dir: '/nonexistent' }), source: mockCms({ data: { collections: {}, globals: {} } }), pages: fsPageStore({ dir: '/nonexistent' }), auth: { authenticate: async () => null, authorize: () => false } }
  const inProduction = (fn: () => unknown) => {
    const env = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      return fn()
    } finally {
      process.env.NODE_ENV = env
    }
  }
  it('requires separate editor and site origins', () => {
    expect(() => inProduction(() => resolveConfig(base))).toThrow(/`origins` is required in production/)
    expect(() => inProduction(() => resolveConfig({ ...base, origins: { site: [SITE], editor: [SITE] } }))).toThrow(/both a site and an editor origin/)
    expect(() => inProduction(() => resolveConfig({ ...base, origins }))).not.toThrow()
    expect(() => inProduction(() => resolveConfig({ ...base, allowSharedOrigin: true }))).not.toThrow()
  })
})

describe('requestOrigin', () => {
  it('uses the addressed host (X-Forwarded-Host/Proto, then Host) over the server-built URL', async () => {
    const { requestOrigin } = await import('../src/server/surface.ts')
    expect(requestOrigin(new Request('http://localhost:3100/editor', { headers: { 'x-forwarded-host': 'editor.localhost:3100', 'x-forwarded-proto': 'http' } }))).toBe('http://editor.localhost:3100')
    expect(requestOrigin(new Request('http://localhost:3100/', { headers: { host: 'www.example.test', 'x-forwarded-proto': 'https' } }))).toBe('https://www.example.test')
    expect(requestOrigin(new Request('http://localhost:3100/', { headers: { host: 'bad host/../x' } }))).toBe('http://localhost:3100')
    expect(requestOrigin(new Request('https://a.test/'))).toBe('https://a.test')
  })
})
