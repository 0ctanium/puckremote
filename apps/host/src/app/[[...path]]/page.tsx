/**
 * Public site: server-rendered with Puck's RSC renderer. Block HTML comes from the isolate
 * (pre-rendered in preparePage); this file never touches developer code.
 */
import { Render } from '@puckeditor/core/rsc'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getHost } from '@/server/host.ts'
import { normalizeSlug } from '@/server/pages.ts'
import { preparePage } from '@/server/public-render.ts'
import { buildRscConfig } from '@/server/puck-rsc.tsx'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const prepare = cache(async (slug: string, qs: string) => {
  const host = await getHost()
  return preparePage(host, slug, Object.fromEntries(new URLSearchParams(qs)))
})

async function load({ params, searchParams }: Props) {
  const slug = normalizeSlug((await params).path)
  if (!slug) notFound()
  const sp = await searchParams
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v]]))).toString()
  const page = await prepare(slug, qs)
  if (!page) notFound()
  return page
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { head } = await load(props)
  const description = head.meta.find((m) => m.name === 'description')?.content
  return {
    title: head.title ?? undefined,
    description,
    other: Object.fromEntries(head.meta.filter((m) => m.name !== 'description').map((m) => [m.name, m.content])),
  }
}

export default async function Page(props: Props) {
  const page = await load(props)
  const host = await getHost()
  const { manifest } = host.store.get()
  return (
    <>
      {page.head.styles.map((href) => (
        // React 19 hoists precedence stylesheets into <head>, deduped.
        <link key={href} rel="stylesheet" href={href} precedence="theme" />
      ))}
      <Render config={buildRscConfig(manifest)} data={page.data} metadata={{ rendered: page.rendered }} />
      {page.head.scripts.map((s) => (
        <script key={s.url} src={s.url} defer={s.defer} async={s.async} type={s.module ? 'module' : undefined} />
      ))}
    </>
  )
}
