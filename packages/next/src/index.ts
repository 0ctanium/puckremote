/**
 * Next.js App Router bindings. All logic lives in @puck-remote/core; these only adapt Next's
 * params/searchParams/notFound/route-handler conventions.
 *
 *   // src/puck-remote.ts
 *   export const remote = createPuckRemote(config)
 *   // app/[[...path]]/page.tsx        → remote.loadPage(props) + <PuckRemotePage page={page} />
 *   // app/editor/[[...path]]/page.tsx → <EditorClient {...await remote.loadEditor(props)} />
 *   // app/api/[[...path]]/route.ts    → export const { GET, POST } = remote.api
 *   // app/theme/[[...path]]/route.ts  → export const { GET } = remote.theme
 */
import { AccessDeniedError, createCore, normalizeSlug, WrongSurfaceError, type EditorProps, type PageContext, type PuckRemoteConfig, type PuckRemoteCore, type PreparedPage } from '@puck-remote/core'
import { pageMetadata } from '@puck-remote/core/react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'

export { PuckRemotePage, pageMetadata } from '@puck-remote/core/react'
export { EditorClient } from '@puck-remote/core/editor'
export type { EditorProps, PageContext, PuckRemoteConfig, PreparedPage }

type Params = Promise<{ path?: string[] }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>
export interface PageProps {
  params: Params
  searchParams?: SearchParams
}

export interface PuckRemote {
  core: PuckRemoteCore
  /** Resolve data and render all blocks in the isolate. Calls notFound() for unknown pages. */
  loadPage(props: PageProps, context?: PageContext): Promise<PreparedPage>
  generateMetadata(props: PageProps): Promise<Metadata>
  loadEditor(props: { params: Params }): Promise<EditorProps>
  api: { GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response> }
  theme: { GET: (req: Request) => Promise<Response>; HEAD: (req: Request) => Promise<Response> }
}

async function slugOf(params: Params, strip?: string): Promise<string> {
  const slug = normalizeSlug((await params).path)
  if (!slug || slug === strip) notFound()
  return slug
}

function firstValues(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(sp)) if (v !== undefined) out[k] = Array.isArray(v) ? v[0] : v
  return out
}

export interface NextBindingOptions {
  /**
   * Where to send unauthenticated editor visitors (`?next=<editor path>` is appended).
   * Without it, denied editor requests render the 404 page (the editor's existence isn't revealed).
   */
  loginUrl?: string
}

/** Rebuild a standard Request from the incoming headers (server components have no Request). */
async function currentRequest(pathname: string): Promise<Request> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  return new Request(`${proto}://${host}${pathname}`, { headers: h })
}

export function createPuckRemote(config: PuckRemoteConfig, options: NextBindingOptions = {}): PuckRemote {
  const core = createCore(config)
  // Per-request memo: generateMetadata and the page share one isolate pass.
  // React cache() is per request, so the memo never crosses requests (or hostnames).
  const prepare = cache(async (slug: string, qs: string, locale: string | undefined) => {
    // The request lets the core check that this origin serves the public site.
    const request = await currentRequest(`/${slug === 'home' ? '' : slug}`)
    return core.preparePage(slug, Object.fromEntries(new URLSearchParams(qs)), { locale, request })
  })
  const loadPage: PuckRemote['loadPage'] = async ({ params, searchParams }, context = {}) => {
    const slug = await slugOf(params)
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
      const path = `${core.config.routes.editor}/${slug === 'home' ? '' : slug}`
      try {
        return await core.loadEditor(slug, await currentRequest(path))
      } catch (e) {
        if (e instanceof WrongSurfaceError) notFound()
        if (!(e instanceof AccessDeniedError)) throw e
        if (e.status === 401 && options.loginUrl) redirect(`${options.loginUrl}?next=${encodeURIComponent(path)}`)
        notFound()
      }
    },
    api: { GET: (req) => core.handleApi(req), POST: (req) => core.handleApi(req) },
    theme: { GET: (req) => core.handleTheme(req), HEAD: (req) => core.handleTheme(req) },
  }
}
