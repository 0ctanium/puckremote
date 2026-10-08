/**
 * Auth, CSRF and production guards on the framework-agnostic entry points.
 */
import { publish } from '@puck-remote/cli'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { fsPageStore } from '@puck-remote/pages-fs'
import type { Action, AuthAdapter } from '@puck-remote/sdk/host'
import { mockCms } from '@puck-remote/source-mock'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccessDeniedError, createCore, devAllowAll, sharedSecretAuth, type PuckRemoteCore } from '../src/index.ts'
import { resolveConfig } from '../src/server/config.ts'
import { buildExample, REPO_ROOT } from './helpers.ts'

const ORIGIN = 'http://site.test'
const req = (p: string, init: RequestInit = {}) => new Request(`${ORIGIN}${p}`, init)
const post = (p: string, opts: { body?: unknown; token?: string; csrf?: boolean; origin?: string | null; site?: string } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.csrf !== false) headers['x-puck-remote'] = '1'
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
  if (opts.site) headers['sec-fetch-site'] = opts.site
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  return req(p, { method: 'POST', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
}
const get = (p: string, token?: string) => req(p, { headers: token ? { authorization: `Bearer ${token}` } : {} })

/** Admin can do everything, "viewer" can only open the editor and read drafts. */
const auth: AuthAdapter = {
  async authenticate(r) {
    const t = r.headers.get('authorization')?.replace('Bearer ', '')
    return t === 'admin' || t === 'viewer' ? { id: t } : null
  },
  authorize: (p, action: Action) => p.id === 'admin' || action === 'editor:open' || action === 'page:read-draft',
}

let core: PuckRemoteCore
let artifactsDir: string

beforeAll(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-auth-'))
  artifactsDir = path.join(dir, 'artifacts')
  await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
  core = createCore({
    id: `auth-${process.pid}`,
    artifacts: fsArtifactStore({ dir: artifactsDir }),
    artifactPollMs: 50,
    source: mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') }),
    pages: fsPageStore({ dir: path.join(dir, 'pages') }),
    auth,
  })
})
afterAll(async () => (await core.host()).store.close())

describe('authentication and authorization', () => {
  it('401 without credentials on every API route, including draft-mode resolve', async () => {
    for (const r of [get('/api/pages?slug=home'), post('/api/pages', { body: { slug: 'x', data: {} } }), post('/api/blocks/resolve', { body: { blockType: 'latest-posts', props: {} } }), post('/api/artifact/reload')]) {
      const res = await core.handleApi(r)
      expect(res.status, r.url).toBe(401)
      expect(res.headers.get('cache-control')).toContain('no-store')
    }
  })

  it('403 when authenticated but not allowed; 200 when allowed', async () => {
    expect((await core.handleApi(post('/api/pages', { token: 'viewer', body: { slug: 'x', data: { root: { props: {} }, content: [] } } }))).status).toBe(403)
    expect((await core.handleApi(post('/api/artifact/reload', { token: 'viewer' }))).status).toBe(403)
    const draft = await core.handleApi(post('/api/blocks/resolve', { token: 'viewer', body: { blockType: 'latest-posts', props: { count: 1 } } }))
    expect(draft.status).toBe(200)
    expect(JSON.stringify(await draft.json())).toContain('DRAFT') // editor data is draft data — hence the auth requirement
    expect((await core.handleApi(post('/api/pages', { token: 'admin', body: { slug: 'x', data: { root: { props: {} }, content: [] } } }))).status).toBe(200)
  })

  it('loadEditor requires editor:open', async () => {
    await expect(core.loadEditor('home', get('/editor'))).rejects.toMatchObject({ status: 401 })
    await expect(core.loadEditor('home', get('/editor', 'nobody'))).rejects.toBeInstanceOf(AccessDeniedError)
    expect((await core.loadEditor('home', get('/editor', 'viewer'))).slug).toBe('home')
  })
})

describe('CSRF', () => {
  const body = { slug: 'x', data: { root: { props: {} }, content: [] } }
  it('rejects mutations without the custom header, even with valid credentials', async () => {
    const res = await core.handleApi(post('/api/pages', { token: 'admin', body, csrf: false }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/x-puck-remote/)
  })
  it('rejects a foreign Origin and cross-site fetches', async () => {
    expect((await core.handleApi(post('/api/pages', { token: 'admin', body, origin: 'https://evil.test' }))).status).toBe(403)
    expect((await core.handleApi(post('/api/pages', { token: 'admin', body, origin: null, site: 'cross-site' }))).status).toBe(403)
  })
  it('accepts allowlisted origins and header-only non-browser clients', async () => {
    const c2 = createCore({ ...core.config, auth, id: `auth2-${process.pid}`, allowedOrigins: ['https://admin.test'] })
    expect((await c2.handleApi(post('/api/pages', { token: 'admin', body, origin: 'https://admin.test' }))).status).toBe(200)
    expect((await core.handleApi(post('/api/pages', { token: 'admin', body, origin: null }))).status).toBe(200) // CLI/CI
    ;(await c2.host()).store.close()
  })
  it('safe methods do not need the header', async () => {
    expect((await core.handleApi(get('/api/pages?slug=x', 'viewer'))).status).toBe(200)
  })
})

describe('built-in adapters and guards', () => {
  it('sharedSecretAuth: bearer or cookie, constant-time compare, missing secret denies everyone', async () => {
    const a = sharedSecretAuth({ secret: 's3cr3t' })
    expect(await a.authenticate(new Request('http://x', { headers: { authorization: 'Bearer s3cr3t' } }))).toMatchObject({ id: 'admin' })
    expect(await a.authenticate(new Request('http://x', { headers: { cookie: 'a=b; puck_remote_token=s3cr3t' } }))).toMatchObject({ id: 'admin' })
    expect(await a.authenticate(new Request('http://x', { headers: { authorization: 'Bearer nope' } }))).toBeNull()
    expect(await sharedSecretAuth({ secret: undefined }).authenticate(new Request('http://x', { headers: { authorization: 'Bearer ' } }))).toBeNull()
  })

  it('production refuses to start without auth, and devAllowAll refuses production', () => {
    const env = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      expect(() => resolveConfig({ ...core.config, auth: undefined })).toThrow(/`auth` is required in production/)
      expect(() => devAllowAll()).toThrow(/must not be used in production/)
    } finally {
      process.env.NODE_ENV = env
    }
  })
})

describe('artifact store change detection', () => {
  it('without a change feed, polling picks up a new pointer', async () => {
    const h = await core.host()
    expect(h.store.get().version).toBe(1)
    // A store without `watch` (like S3 would be): wrap the fs store and drop its feed.
    const { watch: _drop, ...noFeed } = fsArtifactStore({ dir: artifactsDir })
    const c3 = createCore({ ...core.config, auth, id: `poll-${process.pid}`, artifacts: noFeed, artifactPollMs: 50 })
    const h3 = await c3.host()
    await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    await vi.waitFor(() => expect(h3.store.get().version).toBe(2), { timeout: 2000, interval: 25 })
    h3.store.close()
  })
})

describe('editor render RPC', () => {
  const item = { key: 'a', kind: 'block', name: 'card', props: { title: 'Hi' }, data: {} }
  it('requires page:read-draft and the CSRF header', async () => {
    expect((await core.handleApi(post('/api/blocks/render', { body: { slug: 'home', items: [item] } }))).status).toBe(401)
    expect((await core.handleApi(post('/api/blocks/render', { token: 'viewer', csrf: false, body: { slug: 'home', items: [item] } }))).status).toBe(403)
    const res = await core.handleApi(post('/api/blocks/render', { token: 'viewer', body: { slug: 'home', items: [item, { ...item, key: 'b', name: 'nope' }] } }))
    expect(res.status).toBe(200)
    const { results } = await res.json()
    expect(results.a).toMatchObject({ ok: true })
    expect(results.a.html).toContain('Hi')
    expect(results.a.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(results.b).toEqual({ ok: false, error: 'unknown block' })
  })
  it('rejects oversized batches and malformed items', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ ...item, key: String(i) }))
    expect((await core.handleApi(post('/api/blocks/render', { token: 'viewer', body: { slug: 'home', items: many } }))).status).toBe(400)
    expect((await core.handleApi(post('/api/blocks/render', { token: 'viewer', body: { slug: 'home', items: [{ ...item, kind: 'evil' }] } }))).status).toBe(400)
    expect((await core.handleApi(post('/api/blocks/render', { token: 'viewer', body: { slug: 'home', items: [{ ...item, extra: 1 }] } }))).status).toBe(400)
  })
})
