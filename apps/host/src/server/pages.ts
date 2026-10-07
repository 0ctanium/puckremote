import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { mapItems, RESERVED_DATA_PROP, type PageData, type PuckItem } from './page-tree.ts'

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/

export function normalizeSlug(parts: string[] | string | undefined): string | null {
  const slug = (Array.isArray(parts) ? parts.join('/') : (parts ?? '')).replace(/^\/+|\/+$/g, '') || 'home'
  return SLUG.test(slug) ? slug : null
}

const fileFor = (dir: string, slug: string) => path.join(dir, `${slug.replaceAll('/', '__')}.json`)

const pageSchema = z.object({
  root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  content: z.array(z.unknown()),
  zones: z.record(z.string(), z.array(z.unknown())).optional(),
})

export async function readPage(dir: string, slug: string): Promise<PageData | null> {
  const f = fileFor(dir, slug)
  if (!existsSync(f)) return null
  return pageSchema.parse(JSON.parse(await readFile(f, 'utf8'))) as PageData
}

export async function listPages(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  return (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5).replaceAll('__', '/'))
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

export async function writePage(dir: string, slug: string, data: unknown): Promise<PageData> {
  const parsed = pageSchema.parse(data) as PageData
  const clean = stripResolved(parsed)
  await mkdir(dir, { recursive: true })
  const f = fileFor(dir, slug)
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(clean, null, 2) + '\n')
  await rename(tmp, f)
  return clean
}
