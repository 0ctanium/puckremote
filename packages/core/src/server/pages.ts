import type { PageStore } from '@puck-remote/sdk/host'
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

/** Load and validate a page from the operator's PageStore. */
export async function readPage(store: PageStore, slug: string): Promise<PageData | null> {
  const raw = await store.get(slug)
  return raw === null ? null : (pageSchema.parse(raw) as PageData)
}

export const listPages = (store: PageStore) => store.list()

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

/** Validate, strip resolved data, then persist through the PageStore. */
export async function writePage(store: PageStore, slug: string, data: unknown): Promise<PageData> {
  const clean = stripResolved(pageSchema.parse(data) as PageData)
  await store.put(slug, clean)
  return clean
}
