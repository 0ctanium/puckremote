/**
 * Public page renderer (server component; RSC-safe). Block HTML was produced in the isolate by
 * preparePage; this only parses it, swaps slots and emits head assets.
 */
import { Render } from '@puckeditor/core/rsc'
import type { PreparedPage } from '../server/public-render.ts'
import { buildRscConfig } from '../server/puck-rsc.tsx'

export function PuckRemotePage({ page }: { page: PreparedPage }) {
  return (
    <>
      {page.head.styles.map((href) => (
        // React 19 hoists precedence stylesheets into <head>, deduped.
        <link key={href} rel="stylesheet" href={href} precedence="theme" />
      ))}
      <Render config={buildRscConfig(page.manifest)} data={page.data} metadata={{ rendered: page.rendered, islandsUrl: page.islandsUrl }} />
      {page.head.scripts.map((s) => (
        <script key={s.url} src={s.url} defer={s.defer} async={s.async} type={s.module ? 'module' : undefined} nonce={page.scriptNonce} />
      ))}
    </>
  )
}

/** Title/description/meta collected from blocks via ctx.head (shape compatible with Next's Metadata). */
export function pageMetadata(page: PreparedPage): { title?: string; description?: string; other: Record<string, string> } {
  const description = page.head.meta.find((m) => m.name === 'description')?.content
  return {
    title: page.head.title ?? undefined,
    description,
    other: Object.fromEntries(page.head.meta.filter((m) => m.name !== 'description').map((m) => [m.name, m.content])),
  }
}
