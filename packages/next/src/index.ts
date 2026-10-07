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
import { createCore, normalizeSlug, type EditorProps, type PageContext, type PuckRemoteConfig, type PuckRemoteCore, type PreparedPage } from '@puck-remote/core'
import { pageMetadata } from '@puck-remote/core/react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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

export function createPuckRemote(config: PuckRemoteConfig): PuckRemote {
  const core = createCore(config)
  // Per-request memo: generateMetadata and the page share one isolate pass.
  const prepare = cache(async (slug: string, qs: string, locale: string | undefined) => {
    return core.preparePage(slug, Object.fromEntries(new URLSearchParams(qs)), { locale })
  })
  const loadPage: PuckRemote['loadPage'] = async ({ params, searchParams }, context = {}) => {
    const slug = await slugOf(params)
    const qs = new URLSearchParams(firstValues((await searchParams) ?? {})).toString()
    const page = await prepare(slug, qs, context.locale)
    if (!page) notFound()
    return page
  }
  return {
    core,
    loadPage,
    async generateMetadata(props) {
      return pageMetadata(await loadPage(props))
    },
    async loadEditor({ params }) {
      return core.loadEditor(await slugOf(params))
    },
    api: { GET: (req) => core.handleApi(req), POST: (req) => core.handleApi(req) },
    theme: { GET: (req) => core.handleTheme(req), HEAD: (req) => core.handleTheme(req) },
  }
}
