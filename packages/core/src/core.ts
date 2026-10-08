/**
 * The framework-agnostic host runtime. Frameworks bind to it through plain functions and
 * fetch-style handlers (Request → Response); see @puck-remote/next for the Next.js bindings.
 */
import type { Data } from '@puckeditor/core'
import { resolveConfig, type HostConfig, type PuckRemoteConfig, type Routes } from './server/config.ts'
import type { Action, PageMeta, Principal, WriteResult } from '@puck-remote/sdk/host'
import { AccessDeniedError, authenticateRequest, authorizePrincipal, authorizeRequest, checkCsrf } from './server/auth.ts'
import { classifyRequest, WrongSurfaceError } from './server/surface.ts'
import { handleResolve } from './server/editor-rpc.ts'
import { createHost, type Host } from './server/host.ts'
import type { RenderSession } from './server/runtime/types.ts'
import type { Manifest } from './server/manifest-schema.ts'
import { collectInstances, renderProps, type PageData } from './server/page-tree.ts'
import { cleanPage, normalizeSlug, PageFormatError, pageFromRevision, readDraft, saveDraft, stripResolved } from './server/pages.ts'
import { preparePage, restoreMissing, rewriteMissing, type PageContext, type PreparedPage } from './server/public-render.ts'
import { fileResponse, readArtifactFile } from './server/static-files.ts'
import { createPreviewToken, PREVIEW_PARAM } from './server/preview.ts'
import { assetBase, newNonce, renderInIsolate } from './server/render.ts'
import { z } from 'zod'

const renderBatchSchema = z.strictObject({
  slug: z.string().max(200),
  items: z
    .array(
      z.strictObject({
        key: z.string().max(100),
        kind: z.enum(['block', 'root']),
        name: z.string().max(100),
        props: z.record(z.string(), z.unknown()),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(100),
})

const revisionSchema = z.string().min(1).max(200)
const slugSchema = z.strictObject({ slug: z.string().max(200) })
const saveSchema = z.strictObject({ slug: z.string().max(200), data: z.unknown(), baseRevision: revisionSchema.nullable() })
const publishSchema = z.strictObject({ slug: z.string().max(200), revision: revisionSchema })
const restoreSchema = z.strictObject({ slug: z.string().max(200), revision: revisionSchema, baseRevision: revisionSchema.nullable() })

const HISTORY_DEFAULT_LIMIT = 20
const HISTORY_MAX_LIMIT = 100

const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Parse a JSON body with a hard size cap (oversize or invalid → null). */
async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return null
  const text = await request.text().catch(() => '')
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export interface EditorProps {
  manifest: Manifest
  version: number
  slug: string
  site: { name: string; locale: string }
  routes: Routes
  /** Where the public site lives ('' = same origin), for "View page" links. */
  siteOrigin: string
  initialData: Data
  /** The page's draft/published state, or null for a page that doesn't exist yet. */
  page: PageMeta | null
  /** Preview links are configured (shows "Copy preview link"). */
  previewEnabled: boolean
  uncacheable: boolean
}

export interface PuckRemoteCore {
  config: HostConfig
  /** Resolves once the first artifact load was attempted (loads lazily on first use). */
  host(): Promise<Host>
  preparePage(slug: string, query?: Record<string, string>, context?: PageContext): Promise<PreparedPage | null>
  /** Throws AccessDeniedError (401/403) unless `request` may open the editor. */
  loadEditor(slug: string, request: Request): Promise<EditorProps>
  /** `<routes.api>/pages/**` (drafts, publishing, history), `/blocks/resolve`, `/blocks/render`, `/artifact/reload`. */
  handleApi(request: Request): Promise<Response>
  /** `<routes.theme>/v<N>/assets/**` (GET). The theme bundle itself is never served. */
  handleTheme(request: Request): Promise<Response>
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers })

/** 200 with the new meta, or 409 with the current one. */
const writeResult = (r: WriteResult) => (r.ok ? json({ meta: r.meta }) : json({ error: 'conflict', meta: r.meta }, 409))

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
      h.store.watch(config.artifactPollMs)
      return h
    })())

  /**
   * The caller is authenticated before the handler runs (401). Handlers parse their input (400),
   * then call `authorize` with the page they act on (403) before doing anything.
   */
  interface Ctx {
    h: Host
    principal: Principal | null
    authorize(resource?: { slug?: string }): Promise<void>
  }
  type Handler = (request: Request, ctx: Ctx) => Promise<Response>
  /** route → method → [required action, handler]. Everything else is 404/405. */
  const routes: Record<string, Record<string, [Action, Handler]>> = {
    pages: {
      GET: [
        'page:read-draft',
        async (request, ctx) => {
          const slug = normalizeSlug(new URL(request.url).searchParams.get('slug') ?? 'home')
          if (!slug) return json({ error: 'invalid slug' }, 400)
          await ctx.authorize({ slug })
          const [meta, draft] = await Promise.all([config.pages.meta(slug), config.pages.getDraft(slug)])
          if (!meta || !draft) return json({ error: 'not found' }, 404)
          return json({ meta, draft: { ...draft, data: pageFromRevision(slug, draft) } })
        },
      ],
    },
    'pages/save': {
      POST: [
        'page:write',
        async (request, ctx) => {
          const body = saveSchema.safeParse(await readJson(request))
          const slug = body.success ? normalizeSlug(body.data.slug) : null
          if (!body.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          let data: PageData
          try {
            // Resolved data (__data) is stripped; __missing blocks are restored.
            data = cleanPage(restoreMissing(body.data.data as PageData))
          } catch (e) {
            return json({ error: e instanceof Error ? e.message : 'invalid page' }, 400)
          }
          return writeResult(await saveDraft(config.pages, slug, data, { baseRevision: body.data.baseRevision, author: ctx.principal?.id }))
        },
      ],
    },
    'pages/publish': {
      POST: [
        'page:publish',
        async (request, ctx) => {
          const body = publishSchema.safeParse(await readJson(request))
          const slug = body.success ? normalizeSlug(body.data.slug) : null
          if (!body.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          return writeResult(await config.pages.publish(slug, { revision: body.data.revision, author: ctx.principal?.id }))
        },
      ],
    },
    'pages/unpublish': {
      POST: [
        'page:publish',
        async (request, ctx) => {
          const body = slugSchema.safeParse(await readJson(request))
          const slug = body.success ? normalizeSlug(body.data.slug) : null
          if (!body.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          await config.pages.unpublish(slug)
          const meta = await config.pages.meta(slug)
          return meta ? json({ meta }) : json({ error: 'not found' }, 404)
        },
      ],
    },
    'pages/delete': {
      POST: [
        'page:delete',
        async (request, ctx) => {
          const body = slugSchema.safeParse(await readJson(request))
          const slug = body.success ? normalizeSlug(body.data.slug) : null
          if (!body.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          await config.pages.delete(slug)
          return json({ ok: true })
        },
      ],
    },
    'pages/history': {
      GET: [
        'page:read-draft',
        async (request, ctx) => {
          const q = new URL(request.url).searchParams
          const slug = normalizeSlug(q.get('slug') ?? 'home')
          const limit = q.has('limit') ? Number(q.get('limit')) : HISTORY_DEFAULT_LIMIT
          const before = q.get('before') ?? undefined
          if (!slug || !Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT || (before !== undefined && !revisionSchema.safeParse(before).success)) {
            return json({ error: 'invalid query' }, 400)
          }
          await ctx.authorize({ slug })
          return json({ revisions: await config.pages.history(slug, { limit, before }) })
        },
      ],
    },
    'pages/revision': {
      GET: [
        'page:read-draft',
        async (request, ctx) => {
          const q = new URL(request.url).searchParams
          const slug = normalizeSlug(q.get('slug') ?? 'home')
          const revision = revisionSchema.safeParse(q.get('revision'))
          if (!slug || !revision.success) return json({ error: 'invalid query' }, 400)
          await ctx.authorize({ slug })
          const rev = await config.pages.getRevision(slug, revision.data)
          return rev ? json({ ...rev, data: pageFromRevision(slug, rev) }) : json({ error: 'not found' }, 404)
        },
      ],
    },
    'pages/restore': {
      POST: [
        'page:write',
        async (request, ctx) => {
          const body = restoreSchema.safeParse(await readJson(request))
          const slug = body.success ? normalizeSlug(body.data.slug) : null
          if (!body.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          const rev = await config.pages.getRevision(slug, body.data.revision)
          if (!rev) return json({ error: 'not found' }, 404)
          const data = cleanPage(pageFromRevision(slug, rev))
          return writeResult(await saveDraft(config.pages, slug, data, { baseRevision: body.data.baseRevision, author: ctx.principal?.id }))
        },
      ],
    },
    'pages/preview-link': {
      POST: [
        'page:preview',
        async (request, ctx) => {
          const body = publishSchema.safeParse(await readJson(request))
          const slug = body.success ? normalizeSlug(body.data.slug) : null
          if (!body.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          const preview = config.preview
          if (!preview || !(await config.pages.getRevision(slug, body.data.revision))) return json({ error: 'not found' }, 404)
          const { token, expiresAt } = await createPreviewToken(preview.secret, { slug, revision: body.data.revision, ttlSeconds: preview.ttlSeconds })
          const path = slug === 'home' ? '/' : `/${slug}`
          return json({ url: `${config.origins?.site[0] ?? ''}${path}?${PREVIEW_PARAM}=${encodeURIComponent(token)}`, expiresAt })
        },
      ],
    },
    'blocks/resolve': {
      // Editor data RPC (draft mode): body is { blockType, props, slug }; the spec comes from the manifest.
      POST: [
        'page:read-draft',
        async (request, ctx) => {
          const body = (await readJson(request)) as any
          const slug = normalizeSlug(typeof body?.slug === 'string' ? body.slug : 'home')
          if (!slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          const { manifest, runtime } = ctx.h.store.get()
          let session: Promise<RenderSession> | null = null
          try {
            const res = await handleResolve(body, {
              manifest,
              config,
              source: ctx.h.source,
              http: ctx.h.http,
              cache: ctx.h.cache,
              site: config.site,
              session: () => (session ??= runtime.session()),
            })
            return json(res.json, res.status)
          } finally {
            if (session) (await (session as Promise<RenderSession>).catch(() => null))?.release()
          }
        },
      ],
    },
    'blocks/render': {
      // Editor canvas rendering, done server-side so theme code never runs in the editor's origin.
      // `data` comes from the editor (its resolveData results): the caller is an authorized editor,
      // the isolate treats all input as untrusted, and the HTML only goes back to that caller.
      POST: [
        'page:read-draft',
        async (request, ctx) => {
          const parsed = renderBatchSchema.safeParse(await readJson(request))
          const slug = parsed.success ? normalizeSlug(parsed.data.slug) : null
          if (!parsed.success || !slug) return json({ error: 'invalid body' }, 400)
          await ctx.authorize({ slug })
          const { items } = parsed.data
          const { manifest, runtime, version } = ctx.h.store.get()
          const session = await runtime.session()
          const results: Record<string, unknown> = {}
          try {
            for (const item of items) {
              const meta = item.kind === 'root' ? manifest.root : Object.hasOwn(manifest.blocks, item.name) ? manifest.blocks[item.name] : null
              if (!meta) {
                results[item.key] = { ok: false, error: 'unknown block' }
                continue
              }
              const nonce = newNonce()
              const r = await renderInIsolate(session, item.kind, item.name, renderProps(item.props, meta), item.data, {
                isEditing: true,
                locale: config.site.locale,
                nonce,
                page: { slug },
                site: { name: config.site.name },
                assetBase: assetBase(config.routes.theme, version),
              })
              results[item.key] = r.ok ? { ok: true, html: r.html, nonce, effects: r.effects } : { ok: false, error: r.kind }
            }
          } finally {
            session.release()
          }
          return json({ results })
        },
      ],
    },
    'artifact/reload': {
      // Manual reload (the store's change feed or polling also picks up pointer changes).
      POST: [
        'artifact:activate',
        async (_request, ctx) => {
          await ctx.authorize()
          const r = await ctx.h.store.reload()
          return json(r, r.ok ? 200 : 500)
        },
      ],
    },
  }

  async function handleApi(request: Request): Promise<Response> {
    // The editor API only answers on editor origins (404 elsewhere: its existence isn't revealed).
    if (!classifyRequest(request, config).allowed) return json({ error: 'not found' }, 404)
    const sub = subpath(request, config.routes.api)
    const route = sub !== null && Object.hasOwn(routes, sub) ? routes[sub] : null
    if (!route) return json({ error: 'not found' }, 404)
    const entry = Object.hasOwn(route, request.method) ? route[request.method] : null
    if (!entry) return json({ error: 'method not allowed' }, 405, { allow: Object.keys(route).join(', ') })
    const [action, handler] = entry
    try {
      const csrf = checkCsrf(request, config.allowedOrigins)
      if (csrf) throw csrf
      const principal = await authenticateRequest(config.auth, request)
      let authorized = false
      const ctx: Ctx = {
        h: await host(),
        principal,
        async authorize(resource) {
          await authorizePrincipal(config.auth, principal, action, resource)
          authorized = true
        },
      }
      const res = await handler(request, ctx)
      // Every handler must authorize before acting; a 400 before that is the only exception.
      if (!authorized && res.status !== 400) throw new Error(`puck-remote: handler for ${sub} did not authorize`)
      // Editor API responses are per-user and may contain drafts: never cache them.
      res.headers.set('cache-control', 'private, no-store')
      return res
    } catch (e) {
      if (e instanceof AccessDeniedError) return json({ error: e.message }, e.status, { 'cache-control': 'private, no-store' })
      if (e instanceof PageFormatError) return json({ error: e.message }, 500, { 'cache-control': 'private, no-store' })
      throw e
    }
  }

  async function handleTheme(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    if (!classifyRequest(request, config).allowed) return fileResponse(null)
    const sub = subpath(request, config.routes.theme)
    const m = sub === null ? null : /^(v[1-9]\d{0,6})\/(assets\/.+)$/.exec(sub)
    if (!m) return fileResponse(null)
    const [, version, rel] = m
    const f = await readArtifactFile(config.artifacts, version, rel)
    return fileResponse(f)
  }

  return {
    config,
    host,
    async preparePage(slug, query = {}, context = {}) {
      // With a request, the public site only answers on site origins (null → 404).
      if (context.request && !classifyRequest(context.request, config).allowed) return null
      return preparePage(await host(), slug, query, context)
    },
    async loadEditor(slug, request) {
      const where = classifyRequest(request, config)
      if (!where.allowed) throw new WrongSurfaceError('editor', where.origin)
      await authorizeRequest(config.auth, request, 'editor:open', { slug })
      const h = await host()
      const { manifest, version } = h.store.get()
      const draft = await readDraft(config.pages, slug)
      const page = draft?.data ?? { root: { props: { ...(manifest.root?.defaultProps ?? {}) } }, content: [] }
      const data = rewriteMissing(stripResolved(page), manifest)
      return {
        manifest,
        version,
        slug,
        site: config.site,
        routes: config.routes,
        siteOrigin: config.origins?.site[0] ?? '',
        initialData: data as unknown as Data,
        page: draft?.meta ?? null,
        previewEnabled: config.preview !== null,
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
