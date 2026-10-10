import { normalizeSlug } from '@/template-name.ts'
import { PuckRemoteTemplate, type RouteProps } from '@puck-remote/next'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { remote } from '@/puck-remote.ts'

export const dynamic = 'force-dynamic'

// This app maps each path to the template of the same name (/ → home, /search → search). Other
// apps pick templates their own way, e.g. /products/[handle] → 'product' with { handle }.
async function load({ params, searchParams }: RouteProps) {
  const name = normalizeSlug((await params).path)
  if (!name) notFound()
  return remote.loadTemplate(name, { params: { slug: name }, searchParams })
}

export async function generateMetadata(props: RouteProps): Promise<Metadata> {
  const { title, description } = (await load(props)).data.root.props ?? {}
  return {
    title: typeof title === 'string' && title ? `${title} · ${remote.core.config.site.name}` : remote.core.config.site.name,
    description: typeof description === 'string' && description ? description : undefined,
  }
}

export default async function Page(props: RouteProps) {
  return <PuckRemoteTemplate template={await load(props)} />
}
