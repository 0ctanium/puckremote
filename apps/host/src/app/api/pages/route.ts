import { getHost } from '@/server/host.ts'
import { normalizeSlug, readPage, writePage } from '@/server/pages.ts'
import { restoreMissing } from '@/server/public-render.ts'
import type { PageData } from '@/server/page-tree.ts'

export async function GET(req: Request) {
  const slug = normalizeSlug(new URL(req.url).searchParams.get('slug') ?? 'home')
  if (!slug) return Response.json({ error: 'invalid slug' }, { status: 400 })
  const host = await getHost()
  const page = await readPage(host.config.pages, slug)
  return page ? Response.json(page) : Response.json({ error: 'not found' }, { status: 404 })
}

/** Save from the editor. Resolved data (__data) is stripped; __missing blocks are restored. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const slug = normalizeSlug(body?.slug)
  if (!slug || !body?.data) return Response.json({ error: 'invalid body' }, { status: 400 })
  const host = await getHost()
  try {
    const saved = await writePage(host.config.pages, slug, restoreMissing(body.data as PageData))
    return Response.json({ ok: true, slug, blocks: saved.content.length })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'invalid page' }, { status: 400 })
  }
}
