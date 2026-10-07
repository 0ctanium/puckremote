/**
 * Next.js App Router bindings. All logic lives in @poc/core; these only adapt Next's
 * params/searchParams/notFound/route-handler conventions.
 *
 *   // src/poc.ts
 *   export const poc = createPoc(config)
 *   // app/[[...path]]/page.tsx        → poc.loadPage(props) + <PocPage page={page} />
 *   // app/editor/[[...path]]/page.tsx → <EditorClient {...await poc.loadEditor(props)} />
 *   // app/api/[[...path]]/route.ts    → export const { GET, POST } = poc.api
 *   // app/theme/[[...path]]/route.ts  → export const { GET } = poc.theme
 */
import { createPocCore, normalizeSlug, type EditorProps, type PageContext, type PocConfigInput, type PocCore, type PreparedPage } from '@poc/core'
import { pageMetadata } from '@poc/core/react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'

export { PocPage, pageMetadata } from '@poc/core/react'
export { EditorClient } from '@poc/core/editor'
export type { EditorProps, PageContext, PocConfigInput, PreparedPage }

type Params = Promise<{ path?: string[] }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>
export interface PageProps {
  params: Params
  searchParams?: SearchParams
}

export interface Poc {
  core: PocCore
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

export function createPoc(config: PocConfigInput): Poc {
  const core = createPocCore(config)
  // Per-request memo: generateMetadata and the page share one isolate pass.
  const prepare = cache(async (slug: string, qs: string, locale: string | undefined) => {
    return core.preparePage(slug, Object.fromEntries(new URLSearchParams(qs)), { locale })
  })
  const loadPage: Poc['loadPage'] = async ({ params, searchParams }, context = {}) => {
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
