import type { Data } from '@puckeditor/core'
import { notFound } from 'next/navigation'
import { EditorClient } from '@/editor/EditorClient.tsx'
import { getHost } from '@/server/host.ts'
import { normalizeSlug, readPage, stripResolved } from '@/server/pages.ts'
import { collectInstances } from '@/server/page-tree.ts'
import { rewriteMissing } from '@/server/public-render.ts'

export const dynamic = 'force-dynamic'

export default async function EditorPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const slug = normalizeSlug((await params).path)
  if (!slug) notFound()
  const host = await getHost()
  const { manifest, version } = host.store.get()
  const page = (await readPage(host.config.pagesDir, slug)) ?? { root: { props: { ...(manifest.root?.defaultProps ?? {}) } }, content: [] }
  const data = rewriteMissing(stripResolved(page), manifest)
  const uncacheable = collectInstances(data, manifest).some((i) => i.meta?.usesRequestParams)
  return (
    <div style={{ height: '100vh' }}>
      <EditorClient manifest={manifest} version={version} slug={slug} site={host.config.site} initialData={data as unknown as Data} uncacheable={uncacheable} />
    </div>
  )
}
