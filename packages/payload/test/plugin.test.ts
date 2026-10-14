/** puckRemotePlugin: config additions, endpoint auth, previewAs, publish conflicts, theme operations, default template rule. */
import { TemplateError, ThemeError } from '@puck-remote/core'
import type { Config, Endpoint, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { THEME_FILES, THEME_LISTS } from '../src/collections.ts'
import { defaultTemplate, puckRemotePlugin, type PuckRemotePluginOptions } from '../src/plugin.ts'

const THEME = '0123456789ab'

function setup(extra: Partial<PuckRemotePluginOptions> = {}) {
  const core = {
    resolveBlockData: vi.fn(async () => ({ data: { posts: { ok: true } }, usesRequestParams: false })),
    writeTemplate: vi.fn(async () => ({ hash: 'h2' })),
    themes: {
      publish: vi.fn(async (id: string) => ({ id })),
      duplicate: vi.fn(async (id: string) => ({ id: 'ffffffffffff', from: id })),
      rename: vi.fn(async (id: string, name: string) => ({ id, name })),
      delete: vi.fn(async () => {}),
    },
  }
  const config = puckRemotePlugin({ core: () => core as never, editorUrl: 'http://editor.test/', ...extra })({ admin: { user: 'users' } } as Config) as Config
  const endpoint = (path: string) => config.endpoints!.find((e) => e.path === path) as Endpoint
  const call = (path: string, body: unknown, user: unknown = { id: 1, collection: 'users' }, routeParams: Record<string, string> = {}) =>
    endpoint(path).handler({
      user,
      url: 'http://admin.test/api/puck-remote/x',
      headers: new Headers({ cookie: 'payload-token=t' }),
      json: async () => body,
      routeParams,
    } as unknown as PayloadRequest) as Promise<Response>
  return { config, core, call }
}

const block = { template: 'home', theme: THEME, block: 'latest-posts', props: { count: 2 }, params: { slug: 'home' } }

describe('puckRemotePlugin', () => {
  it('adds the store collections (unless artifacts: false), the views, the nav link and the endpoints', () => {
    const { config } = setup()
    expect(config.collections!.map((c) => c.slug)).toEqual([THEME_LISTS, THEME_FILES])
    expect(setup({ artifacts: false }).config.collections).toEqual([])
    expect(Object.values(config.admin!.components!.views!).map((v) => (v as { path: string }).path)).toEqual(['/puck-remote', '/puck-remote/editor'])
    expect(config.admin!.components!.afterNavLinks).toHaveLength(1)
    expect(config.endpoints!.map((e) => e.path)).toEqual(['/puck-remote/resolve-data', '/puck-remote/publish', '/puck-remote/themes/:op'])
  })

  it('refuses anonymous callers (401) and users access does not allow (403)', async () => {
    const { call, core } = setup()
    expect((await call('/puck-remote/resolve-data', block, null)).status).toBe(401)
    expect((await call('/puck-remote/resolve-data', block, { id: 2, collection: 'members' })).status).toBe(403)
    const custom = setup({ access: ({ user }) => user.id === 2 })
    expect((await custom.call('/puck-remote/resolve-data', block, { id: 2, collection: 'members' })).status).toBe(200)
    expect(core.resolveBlockData).not.toHaveBeenCalled()
  })

  it("resolve-data forwards the request with previewAs 'user' (default), none with 'anonymous'", async () => {
    const asUser = setup()
    const r = await asUser.call('/puck-remote/resolve-data', block)
    expect(await r.json()).toEqual({ data: { posts: { ok: true } }, usesRequestParams: false })
    const [name, b, props, opts] = asUser.core.resolveBlockData.mock.calls[0] as unknown as [string, string, object, { request?: Request; theme: string; params: object }]
    expect([name, b, props, opts.theme, opts.params]).toEqual(['home', 'latest-posts', { count: 2 }, THEME, { slug: 'home' }])
    expect(opts.request!.url).toBe('http://admin.test/')
    expect(opts.request!.headers.get('cookie')).toBe('payload-token=t')

    const anonymous = setup({ previewAs: 'anonymous' })
    await anonymous.call('/puck-remote/resolve-data', block)
    expect((anonymous.core.resolveBlockData.mock.calls[0] as unknown as [string, string, object, object])[3]).not.toHaveProperty('request')
    expect((await asUser.call('/puck-remote/resolve-data', { ...block, theme: '../x' })).status).toBe(400)
  })

  it('publish writes the template with expect; conflicts and invalid templates are results', async () => {
    const { call, core } = setup()
    const body = { template: 'home', theme: THEME, base: 'h1', data: { root: {}, content: [] } }
    expect(await (await call('/puck-remote/publish', body)).json()).toEqual({ ok: true, hash: 'h2' })
    expect(core.writeTemplate).toHaveBeenCalledWith('home', body.data, { theme: THEME, expect: 'h1' })
    core.writeTemplate.mockRejectedValueOnce(new ThemeError('changed', 409))
    expect(await (await call('/puck-remote/publish', body)).json()).toEqual({ ok: false, error: 'conflict' })
    core.writeTemplate.mockRejectedValueOnce(new TemplateError('bad template'))
    expect(await (await call('/puck-remote/publish', body)).json()).toEqual({ ok: false, error: 'bad template' })
  })

  it('themes/:op runs publish, duplicate, rename and delete', async () => {
    const { call, core } = setup()
    const op = (name: string, body: object) => call('/puck-remote/themes/:op', { theme: THEME, ...body }, undefined, { op: name })
    expect((await op('publish', {})).status).toBe(200)
    expect((await op('duplicate', {})).status).toBe(200)
    expect((await op('rename', { name: 'Summer' })).status).toBe(200)
    expect((await op('delete', {})).status).toBe(200)
    expect((await op('rename', {})).status).toBe(400)
    expect((await op('nope', {})).status).toBe(404)
    expect(core.themes.rename).toHaveBeenCalledWith(THEME, 'Summer')
    expect(core.themes.delete).toHaveBeenCalledWith(THEME)
  })
})

describe('defaultTemplate', () => {
  it('maps a path to the template of the same name', () => {
    expect(defaultTemplate('/')).toEqual({ name: 'home', params: { slug: 'home' } })
    expect(defaultTemplate('/blog/post-1/')).toEqual({ name: 'blog/post-1', params: { slug: 'blog/post-1' } })
    expect(defaultTemplate('/../x')).toBeNull()
  })
})
