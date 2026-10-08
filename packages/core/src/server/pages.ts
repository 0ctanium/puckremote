import type { PageMeta, PageRevision, PageStore, WriteResult } from '@puck-remote/sdk/host'
import { z } from 'zod'
import { mapItems, RESERVED_DATA_PROP, type PageData, type PuckItem } from './page-tree.ts'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/

export function normalizeSlug(parts: string[] | string | undefined): string | null {
  const slug = (Array.isArray(parts) ? parts.join('/') : (parts ?? '')).replace(/^\/+|\/+$/g, '') || 'home'
  return SLUG.test(slug) ? slug : null
}

const pageSchema = z.object({
  root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  content: z.array(z.unknown()),
  zones: z.record(z.string(), z.array(z.unknown())).optional(),
})

/** Version of the page format the core writes (stored on every revision, D-0068). */
export const PAGE_SCHEMA_VERSION = 1

/** Upgrades from older page formats: key N turns format N-1 into N. Empty while only v1 exists. */
const PAGE_UPGRADES: Record<number, (data: unknown) => unknown> = {}

export class PageFormatError extends Error {
  constructor(slug: string, version: number) {
    super(`page ${slug} uses page format ${version}; this version of puck-remote reads up to ${PAGE_SCHEMA_VERSION}`)
    this.name = 'PageFormatError'
  }
}

/** Upgrade (if needed) and validate a stored revision's data. */
export function pageFromRevision(slug: string, rev: PageRevision): PageData {
  if (!Number.isInteger(rev.schemaVersion) || rev.schemaVersion < 1 || rev.schemaVersion > PAGE_SCHEMA_VERSION) throw new PageFormatError(slug, rev.schemaVersion)
  let data = rev.data
  for (let v = rev.schemaVersion + 1; v <= PAGE_SCHEMA_VERSION; v++) data = PAGE_UPGRADES[v](data)
  return pageSchema.parse(data) as PageData
}

/** The published page, or null (missing or unpublished). */
export async function readPublished(store: PageStore, slug: string): Promise<PageData | null> {
  const rev = await store.getPublished(slug)
  return rev ? pageFromRevision(slug, rev) : null
}

/** The latest draft and the page's meta, or null if the page doesn't exist. */
export async function readDraft(store: PageStore, slug: string): Promise<{ meta: PageMeta; data: PageData } | null> {
  const [meta, rev] = await Promise.all([store.meta(slug), store.getDraft(slug)])
  return meta && rev ? { meta, data: pageFromRevision(slug, rev) } : null
}

const stripItem = (item: PuckItem): PuckItem => {
  const { [RESERVED_DATA_PROP]: _drop, ...props } = item.props
  const out: PuckItem = { ...item, props }
  if (item.readOnly) {
    const { [RESERVED_DATA_PROP]: _ro, ...readOnly } = item.readOnly
    if (Object.keys(readOnly).length) out.readOnly = readOnly
    else delete out.readOnly
  }
  return out
}

/** Remove everything resolveData produced (and any reserved host keys) before persisting. */
export function stripResolved(data: PageData): PageData {
  const mapped = mapItems(data, null, stripItem)
  const rootProps = { ...(data.root?.props ?? {}) }
  delete rootProps[RESERVED_DATA_PROP]
  const root: PageData['root'] = { ...data.root, props: rootProps }
  if (root.readOnly) {
    const { [RESERVED_DATA_PROP]: _ro, ...ro } = root.readOnly
    if (Object.keys(ro).length) root.readOnly = ro
    else delete root.readOnly
  }
  return { ...mapped, root }
}

/** Validate and clean editor data for storage (resolved data stripped). Throws on invalid data. */
export function cleanPage(data: unknown): PageData {
  return stripResolved(pageSchema.parse(data) as PageData)
}

/** Persist cleaned page data as a new draft revision. */
export function saveDraft(store: PageStore, slug: string, data: PageData, opts: { baseRevision: string | null; author?: string }): Promise<WriteResult> {
  return store.saveDraft(slug, { data, schemaVersion: PAGE_SCHEMA_VERSION }, opts)
}
