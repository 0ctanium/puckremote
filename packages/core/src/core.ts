/**
 * The framework-agnostic host runtime. Frameworks bind to it through plain functions and
 * fetch-style handlers (Request → Response); see @puck-remote/next for the Next.js bindings.
 */
import type { Data } from '@puckeditor/core'
import { resolveConfig, type HostConfig, type PuckRemoteConfig, type Routes } from './server/config.ts'
import { handleResolve } from './server/editor-rpc.ts'
import { createHost, type Host } from './server/host.ts'
import type { RenderSession } from './server/isolate-runner.ts'
import type { Manifest } from './server/manifest-schema.ts'
import { collectInstances, type PageData } from './server/page-tree.ts'
import { normalizeSlug, readPage, stripResolved, writePage } from './server/pages.ts'
import { preparePage, restoreMissing, rewriteMissing, type PageContext, type PreparedPage } from './server/public-render.ts'
import { fileResponse, readArtifactFile } from './server/static-files.ts'

export interface EditorProps {
  manifest: Manifest
  version: number
  slug: string
  site: { name: string; locale: string }
  routes: Routes
  initialData: Data
  uncacheable: boolean
}

export interface PuckRemoteCore {
  config: HostConfig
  /** Resolves once the first artifact load was attempted (loads lazily on first use). */
  host(): Promise<Host>
  preparePage(slug: string, query?: Record<string, string>, context?: PageContext): Promise<PreparedPage | null>
  loadEditor(slug: string): Promise<EditorProps>
  /** `<routes.api>/pages` (GET ?slug=, POST), `/blocks/resolve` (POST), `/artifact/reload` (POST). */
  handleApi(request: Request): Promise<Response>
  /** `<routes.theme>/v<N>/bundle.js` and `<routes.theme>/v<N>/assets/**` (GET). */
  handleTheme(request: Request): Promise<Response>
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers })

/** Path below a route prefix, or null if the request is outside it. */
function subpath(request: Request, prefix: string): string | null {
  const { pathname } = new URL(request.url)
  const p = prefix.replace(/\/+$/, '')
  if (pathname !== p && !pathname.startsWith(p + '/')) return null
  return pathname.slice(p.length).replace(/^\/+/, '')
}

function build(config: HostConfig): PuckRemoteCore {
  let hostP: Promise<Host> | null = null
  const host = () =>
    (hostP ??= (async () => {
      const h = createHost(config)
      const r = await h.store.reload()
      if (!r.ok) console.error('[puck-remote] no artifact could be loaded at startup:', r.error)
      h.store.watch()
      return h
    })())

  async function handleApi(request: Request): Promise<Response> {
    const sub = subpath(request, config.routes.api)
    const h = await host()
    switch (sub) {
      case 'pages': {
        if (request.method === 'GET') {
          const slug = normalizeSlug(new URL(request.url).searchParams.get('slug') ?? 'home')
          if (!slug) return json({ error: 'invalid slug' }, 400)
          const page = await readPage(config.pages, slug)
          return page ? json(page) : json({ error: 'not found' }, 404)
        }
        if (request.method === 'POST') {
          // Editor save: resolved data (__data) is stripped; __missing blocks are restored.
          const body = await request.json().catch(() => null)
          const slug = normalizeSlug(body?.slug)
          if (!slug || !body?.data) return json({ error: 'invalid body' }, 400)
          try {
            const saved = await writePage(config.pages, slug, restoreMissing(body.data as PageData))
            return json({ ok: true, slug, blocks: saved.content.length })
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : 'invalid page' }, 400)
          }
        }
        return json({ error: 'method not allowed' }, 405, { allow: 'GET, POST' })
      }
      case 'blocks/resolve': {
        // Editor data RPC: body is { blockType, props, slug }. The spec always comes from the manifest.
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { allow: 'POST' })
        const body = await request.json().catch(() => null)
        const { manifest, runtime } = h.store.get()
        let session: Promise<RenderSession> | null = null
        try {
          const res = await handleResolve(body, {
            manifest,
            config,
            source: h.source,
            http: h.http,
            cache: h.cache,
            site: config.site,
            session: () => (session ??= runtime.session()),
          })
          return json(res.json, res.status, { 'cache-control': 'no-store' })
        } finally {
          if (session) (await (session as Promise<RenderSession>).catch(() => null))?.release()
        }
      }
      case 'artifact/reload': {
        // Manual reload (the file watcher also reloads on current.json changes).
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { allow: 'POST' })
        const r = await h.store.reload()
        return json(r, r.ok ? 200 : 500)
      }
      default:
        return json({ error: 'not found' }, 404)
    }
  }

  async function handleTheme(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    const sub = subpath(request, config.routes.theme)
    const m = sub === null ? null : /^(v[1-9]\d{0,6})\/(bundle\.js|assets\/.+)$/.exec(sub)
    if (!m) return fileResponse(null)
    const [, version, rel] = m
    // bundle.js is served to the EDITOR (browser) only; the server never evaluates it outside the isolate.
    const f = await readArtifactFile(config.artifactsDir, version, rel)
    return fileResponse(f && rel === 'bundle.js' ? { ...f, type: 'text/javascript; charset=utf-8' } : f)
  }

  return {
    config,
    host,
    async preparePage(slug, query = {}, context = {}) {
      return preparePage(await host(), slug, query, context)
    },
    async loadEditor(slug) {
      const h = await host()
      const { manifest, version } = h.store.get()
      const page = (await readPage(config.pages, slug)) ?? { root: { props: { ...(manifest.root?.defaultProps ?? {}) } }, content: [] }
      const data = rewriteMissing(stripResolved(page), manifest)
      return {
        manifest,
        version,
        slug,
        site: config.site,
        routes: config.routes,
        initialData: data as unknown as Data,
        uncacheable: collectInstances(data, manifest).some((i) => i.meta?.usesRequestParams),
      }
    },
    handleApi,
    handleTheme,
  }
}

/**
 * Process-wide runtime for a config, memoized on globalThis by `config.id` so every route
 * bundle (and dev HMR) shares one artifact store, isolate, cache and file watcher.
 */
export function createCore(input: PuckRemoteConfig): PuckRemoteCore {
  const config = resolveConfig(input)
  const key = Symbol.for(`remote.core:${config.id}`)
  const g = globalThis as typeof globalThis & { [k: symbol]: PuckRemoteCore | undefined }
  return (g[key] ??= build(config))
}
