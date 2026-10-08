/**
 * Next.js App Router bindings. All logic lives in @puck-remote/core; these only adapt Next's
 * params/searchParams/notFound/route-handler conventions.
 *
 *   // src/puck-remote.ts
 *   export const remote = createPuckRemote(config)
 *   // app/[[...path]]/page.tsx            → remote.loadPage(props) + <PuckRemotePage page={page} />
 *   // app/admin/[[...path]]/page.tsx      → <PuckEditorFrame payload={await remote.loadEditor(props)} … />
 *   // app/admin/rpc/route.ts              → export const { POST } = remote.createEditorRpcRoute(handlers)
 *   // app/theme/[[...path]]/route.ts      → export const { GET, HEAD } = remote.theme
 */
import { createCore, normalizeSlug, type EditorPayload, type PageContext, type PuckRemoteConfig, type PuckRemoteCore, type PreparedPage } from '@puck-remote/core'
import { requestOrigin } from '@puck-remote/core/edge'
import { pageMetadata } from '@puck-remote/core/react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache } from 'react'

export { PuckRemotePage, pageMetadata } from '@puck-remote/core/react'
export type { EditorPayload, PageContext, PuckRemoteConfig, PreparedPage }

type Params = Promise<{ path?: string[] }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>
export interface PageProps {
  params: Params
  searchParams?: SearchParams
}

/** A server-side RPC handler. Wrap it with your own auth: the request carries the admin session. */
export type EditorRpcHandler = (params: unknown, request: Request) => Promise<unknown> | unknown

/** Max RPC request body (JSON). */
const RPC_MAX_BYTES = 1024 * 1024

export interface PuckRemote {
  core: PuckRemoteCore
  /** Resolve data and render all blocks in the isolate. Calls notFound() for unknown pages and on admin origins. */
  loadPage(props: PageProps, context?: PageContext): Promise<PreparedPage>
  generateMetadata(props: PageProps): Promise<Metadata>
  /** The editor payload for an admin page. Calls notFound() outside the configured admin origins. */
  loadEditor(props: { params: Params }): Promise<EditorPayload>
  /**
   * POST route dispatching `{ method, params }` to allow-listed handlers. Refuses requests whose
   * Origin is not an admin origin, and bodies over 1 MB. Authentication is the handlers' job.
   */
  createEditorRpcRoute(handlers: Record<string, EditorRpcHandler>): { POST: (req: Request) => Promise<Response> }
  theme: { GET: (req: Request) => Promise<Response>; HEAD: (req: Request) => Promise<Response> }
}

async function slugOf(params: Params): Promise<string> {
  const slug = normalizeSlug((await params).path)
  if (!slug) notFound()
  return slug
}

function firstValues(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(sp)) if (v !== undefined) out[k] = Array.isArray(v) ? v[0] : v
  return out
}

/** Rebuild a standard Request from the incoming headers (server components have no Request). */
async function currentRequest(pathname: string): Promise<Request> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  return new Request(`${proto}://${host}${pathname}`, { headers: h })
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } })

export function createPuckRemote(config: PuckRemoteConfig): PuckRemote {
  const core = createCore(config)
  // Per-request memo: generateMetadata and the page share one isolate pass.
  // React cache() is per request, so the memo never crosses requests (or hostnames).
  const prepare = cache(async (slug: string, qs: string, locale: string | undefined) => {
    return core.preparePage(slug, Object.fromEntries(new URLSearchParams(qs)), { locale })
  })
  const isAdmin = (request: Request) => !!core.config.origins?.admin.includes(requestOrigin(request))
  const loadPage: PuckRemote['loadPage'] = async ({ params, searchParams }, context = {}) => {
    const slug = await slugOf(params)
    // Theme scripts run on public pages: never next to the admin session.
    if (isAdmin(await currentRequest('/'))) notFound()
    const qs = new URLSearchParams(firstValues((await searchParams) ?? {})).toString()
    const page = await prepare(slug, qs, context.locale)
    if (!page) notFound()
    // Theme <script> tags need the per-request CSP nonce set by createProxy.
    const nonce = (await headers()).get('x-nonce')
    return nonce ? { ...page, scriptNonce: nonce } : page
  }
  return {
    core,
    loadPage,
    async generateMetadata(props) {
      return pageMetadata(await loadPage(props))
    },
    async loadEditor({ params }) {
      const slug = await slugOf(params)
      // Admin pages exist only on admin origins (the editor's existence isn't revealed elsewhere).
      if (!isAdmin(await currentRequest('/'))) notFound()
      return core.editorPayload(slug)
    },
    createEditorRpcRoute(handlers) {
      return {
        async POST(request) {
          // Same-origin calls from the admin page only (CSRF): browsers always send Origin on POST.
          const origin = request.headers.get('origin')
          if (!origin || !core.config.origins?.admin.includes(origin) || !isAdmin(request)) return json({ error: 'not found' }, 404)
          if (Number(request.headers.get('content-length') ?? 0) > RPC_MAX_BYTES) return json({ error: 'too large' }, 413)
          const text = await request.text().catch(() => '')
          if (Buffer.byteLength(text) > RPC_MAX_BYTES) return json({ error: 'too large' }, 413)
          let body: { method?: unknown; params?: unknown }
          try {
            body = JSON.parse(text)
          } catch {
            return json({ error: 'invalid body' }, 400)
          }
          const method = typeof body?.method === 'string' ? body.method : ''
          if (!Object.hasOwn(handlers, method)) return json({ error: 'unknown method' }, 404)
          return json({ value: await handlers[method](body.params, request) })
        },
      }
    },
    theme: { GET: (req) => core.handleTheme(req), HEAD: (req) => core.handleTheme(req) },
  }
}
