/**
 * Pages live inside the theme artifact (pages/<slug>.json, listed in manifest.files), like a
 * Shopify theme's templates. Reading verifies the page's hash; writing produces a new artifact
 * (same files, new page, rewritten manifest) and never moves the pointer.
 */
import { createHash } from 'node:crypto'
import type { ArtifactId, ArtifactStore } from '@puck-remote/sdk/host'
import { z } from 'zod'
import { isArtifactId } from './artifact-loader.ts'
import { pagePath, pageSlugs, type Manifest } from './manifest-schema.ts'
import { mapItems, RESERVED_DATA_PROP, restoreMissing, type PageData, type PuckItem } from './page-tree.ts'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/

/** Page JSON size cap. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024

export function normalizeSlug(parts: string[] | string | undefined): string | null {
  const slug = (Array.isArray(parts) ? parts.join('/') : (parts ?? '')).replace(/^\/+|\/+$/g, '') || 'home'
  return SLUG.test(slug) ? slug : null
}

const pageSchema = z.object({
  root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  content: z.array(z.unknown()),
  zones: z.record(z.string(), z.array(z.unknown())).optional(),
})

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

export class PageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageError'
  }
}

/** A page of an artifact, hash-verified and validated, or null when the artifact has no such page. */
export async function readPage(store: ArtifactStore, id: ArtifactId, manifest: Pick<Manifest, 'files'>, slug: string): Promise<PageData | null> {
  const file = pagePath(slug)
  const expected = Object.hasOwn(manifest.files, file) ? manifest.files[file] : null
  if (!expected) return null
  const bytes = await store.readFile(id, file)
  if (!bytes) throw new PageError(`page ${slug} is missing from artifact ${id}`)
  if (sha256(bytes) !== expected) throw new PageError(`page ${slug}: hash mismatch in artifact ${id}`)
  return pageSchema.parse(JSON.parse(decoder.decode(bytes))) as PageData
}

export { pageSlugs }

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

/** Validate and clean editor data for storage (resolved data stripped, missing blocks restored). Throws on invalid data. */
export function cleanPage(data: unknown): PageData {
  return stripResolved(restoreMissing(pageSchema.parse(data) as PageData))
}

/**
 * Write a page into a copy of the `base` artifact and return the new artifact's id. The pointer
 * is not moved: making the result current is the caller's decision (a "publish" plugin).
 */
export async function writePage(store: ArtifactStore, base: ArtifactId, slug: string, data: unknown): Promise<{ id: ArtifactId }> {
  if (!normalizeSlug(slug) || normalizeSlug(slug) !== slug) throw new PageError(`invalid slug ${slug}`)
  if (!isArtifactId(base)) throw new PageError('invalid base artifact id')
  let page: PageData
  try {
    page = cleanPage(data)
  } catch {
    throw new PageError('invalid page data')
  }
  const pageBytes = encoder.encode(JSON.stringify(page, null, 2) + '\n')
  if (pageBytes.byteLength > MAX_PAGE_BYTES) throw new PageError(`page ${slug} is larger than ${MAX_PAGE_BYTES} bytes`)

  // The raw manifest (not the loader's parsed copy, which carries recomputed analysis).
  const manifestBytes = await store.readFile(base, 'manifest.json')
  if (!manifestBytes) throw new PageError(`artifact ${base} does not exist`)
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as { files: Record<string, string> }
  const files: Record<string, Uint8Array> = {}
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const bytes = await store.readFile(base, rel)
    if (!bytes || sha256(bytes) !== expected) throw new PageError(`artifact ${base}: ${rel} is missing or corrupted`)
    files[rel] = bytes
  }
  const file = pagePath(slug)
  files[file] = pageBytes
  manifest.files = Object.fromEntries(Object.entries({ ...manifest.files, [file]: sha256(pageBytes) }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2))
  return { id: await store.writeArtifact(files) }
}
