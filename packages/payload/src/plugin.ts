/**
 * `@puck-remote/payload/plugin` — puck-remote inside Payload's admin (the host origin):
 *
 *  - the artifact store's collections (`artifacts`, default true);
 *  - admin views: the themes (`/admin/puck-remote`) and the editor
 *    (`/admin/puck-remote/editor?theme=&previewPath=`), with a nav link;
 *  - endpoints the views call, under Payload's API (`/api/puck-remote/...`), authenticated by
 *    Payload's session and checked with `access`.
 *
 * The editor frame page (editor origin), the public pages, `/api/themes` and the theme files stay
 * app routes wired with @puck-remote/next.
 */
import type { PuckRemoteCore } from '@puck-remote/core'
import type { Config, Endpoint, PayloadRequest, Plugin } from 'payload'
import { artifactCollections } from './collections.ts'
import type { PayloadUser } from './source.ts'

export interface PuckRemotePluginOptions {
  /** puck-remote's core, resolved on first use (e.g. `() => import('./puck-remote').then((m) => m.remote.core)`). */
  core: () => PuckRemoteCore | Promise<PuckRemoteCore>
  /** The editor page on the editor origin (the frame's src), e.g. `http://127.0.0.1:3300/`. */
  editorUrl: string
  /** Whose data the editor previews: the logged-in user's (drafts included) or an anonymous visitor's. Default 'user'. */
  previewAs?: 'user' | 'anonymous'
  /** Add the artifact store's collections (for payloadArtifactStore). Default true. */
  artifacts?: boolean
  /** Who may open the views and call the endpoints. Default: users of the admin user collection. */
  access?: (args: { user: PayloadUser }) => boolean | Promise<boolean>
  /** The template (and params) a site path renders, for `?previewPath=`. Default: the path names the template ('/' → 'home'). */
  template?: (previewPath: string) => { name: string; params?: Record<string, string> } | null
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/

/** The default path → template rule: '/blog/x' → 'blog/x' with { slug }, '/' → 'home'. */
export function defaultTemplate(previewPath: string): { name: string; params: Record<string, string> } | null {
  const name = previewPath.replace(/^\/+|\/+$/g, '') || 'home'
  return NAME.test(name) ? { name, params: { slug: name } } : null
}

/** Resolved options, shared by the endpoints and the admin views. */
export interface ResolvedPluginOptions extends Required<Omit<PuckRemotePluginOptions, 'access'>> {
  access: (args: { user: PayloadUser }) => boolean | Promise<boolean>
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** The request rebuilt for the data source: headers and the origin root, like the Next bindings. */
function sourceRequest(req: PayloadRequest): Request {
  const url = new URL(req.url ?? 'http://localhost/')
  return new Request(`${url.origin}/`, { headers: req.headers })
}

const THEME_ID = /^[0-9a-f]{12}$/
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : null)
const strings = (v: unknown): Record<string, string> | undefined =>
  v && typeof v === 'object' && Object.values(v).every((x) => typeof x === 'string') ? (v as Record<string, string>) : undefined

export function puckRemotePlugin(opts: PuckRemotePluginOptions): Plugin {
  return (config: Config): Config => {
    const adminUser = config.admin?.user
    const o: ResolvedPluginOptions = {
      previewAs: 'user',
      artifacts: true,
      template: defaultTemplate,
      ...opts,
      access: opts.access ?? (({ user }) => user.collection === adminUser),
    }

    /** The caller's user when allowed, otherwise the error response. */
    const allowed = async (req: PayloadRequest): Promise<Response | null> => {
      const user = req.user as PayloadUser | null
      if (!user) return json({ error: 'unauthorized' }, 401)
      if (!(await o.access({ user }))) return json({ error: 'forbidden' }, 403)
      return null
    }
    const body = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
      const b = await req.json?.().catch(() => null)
      return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
    }

    const endpoints: Endpoint[] = [
      {
        path: '/puck-remote/resolve-data',
        method: 'post',
        handler: async (req) => {
          const denied = await allowed(req)
          if (denied) return denied
          const b = await body(req)
          const template = str(b.template)
          const theme = str(b.theme)
          const block = str(b.block, 100)
          if (!template || !theme || !THEME_ID.test(theme) || !block || !b.props || typeof b.props !== 'object') return json({ error: 'invalid params' }, 400)
          const core = await o.core()
          const result = await core.resolveBlockData(template, block, b.props as Record<string, unknown>, {
            params: strings(b.params),
            theme,
            // 'user': the data source sees the logged-in user (drafts included); 'anonymous': a visitor.
            ...(o.previewAs === 'user' ? { request: sourceRequest(req) } : {}),
          })
          return json(result)
        },
      },
      {
        path: '/puck-remote/publish',
        method: 'post',
        handler: async (req) => {
          const denied = await allowed(req)
          if (denied) return denied
          const b = await body(req)
          const template = str(b.template)
          const theme = str(b.theme)
          const base = str(b.base, 128)
          if (!template || !theme || !THEME_ID.test(theme) || !base) return json({ error: 'invalid params' }, 400)
          const { ThemeError, TemplateError } = await import('@puck-remote/core')
          try {
            // `expect`: saving on an old version would undo whatever was pushed since.
            const { hash } = await (await o.core()).writeTemplate(template, b.data, { theme, expect: base })
            return json({ ok: true, hash })
          } catch (e) {
            if (e instanceof ThemeError && e.status === 409) return json({ ok: false, error: 'conflict' })
            if (e instanceof TemplateError) return json({ ok: false, error: e.message })
            throw e
          }
        },
      },
      {
        path: '/puck-remote/themes/:op',
        method: 'post',
        handler: async (req) => {
          const denied = await allowed(req)
          if (denied) return denied
          const op = req.routeParams?.op
          const b = await body(req)
          const theme = str(b.theme)
          if (!theme || !THEME_ID.test(theme)) return json({ error: 'invalid theme' }, 400)
          const { ThemeError } = await import('@puck-remote/core')
          const themes = (await o.core()).themes
          try {
            if (op === 'publish') return json({ ok: true, theme: await themes.publish(theme) })
            if (op === 'duplicate') return json({ ok: true, theme: await themes.duplicate(theme) })
            if (op === 'delete') return (await themes.delete(theme), json({ ok: true }))
            if (op === 'rename') {
              const name = str(b.name, 50)
              if (!name) return json({ error: 'invalid name' }, 400)
              return json({ ok: true, theme: await themes.rename(theme, name) })
            }
            return json({ error: 'unknown operation' }, 404)
          } catch (e) {
            if (e instanceof ThemeError) return json({ ok: false, error: e.message }, e.status)
            throw e
          }
        },
      },
    ]

    const view = (exportName: string) => ({ path: '@puck-remote/payload/admin', exportName, serverProps: { puckRemote: o } })

    return {
      ...config,
      collections: [...(config.collections ?? []), ...(o.artifacts ? artifactCollections() : [])],
      endpoints: [...(config.endpoints ?? []), ...endpoints],
      admin: {
        ...config.admin,
        components: {
          ...config.admin?.components,
          afterNavLinks: [...(config.admin?.components?.afterNavLinks ?? []), { path: '@puck-remote/payload/admin', exportName: 'NavLink' }],
          views: {
            ...config.admin?.components?.views,
            puckRemoteThemes: { Component: view('ThemesView'), path: '/puck-remote', exact: true },
            puckRemoteEditor: { Component: view('EditorView'), path: '/puck-remote/editor', exact: true },
          },
        },
      },
    }
  }
}
