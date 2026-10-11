/**
 * Public template renderer (server component; RSC-safe). Block HTML was produced in the isolate
 * by prepareTemplate; this only parses it, swaps slots and emits head assets. A preview opened from
 * `puck-remote dev` also gets a tiny live reload script listening to the developer's local server.
 */
import { Render } from '@puckeditor/core/rsc'
import type { PreparedTemplate } from '../server/public-render.ts'
import { buildRscConfig } from '../server/puck-rsc.tsx'
import { reloadOrigin } from '../shared/preview-cookie.ts'

/** Reloads the page on the `reload` event of a `puck-remote dev` server (SSE). */
function reloadScript(origin: string): string {
  // `origin` is a validated loopback origin; JSON-encoded anyway.
  return `new EventSource(${JSON.stringify(`${origin}/events`)}).addEventListener('reload',function(){location.reload()})`
}

export function PuckRemoteTemplate({ template }: { template: PreparedTemplate }) {
  const reload = reloadOrigin(template.preview?.reload)
  return (
    <>
      {template.head.styles.map((href) => (
        // React 19 hoists precedence stylesheets into <head>, deduped.
        <link key={href} rel="stylesheet" href={href} precedence="theme" />
      ))}
      <Render config={buildRscConfig(template.manifest)} data={template.data} metadata={{ rendered: template.rendered, islandsUrl: template.islandsUrl }} />
      {template.head.scripts.map((s) => (
        <script key={s.url} src={s.url} defer={s.defer} async={s.async} type={s.module ? 'module' : undefined} nonce={template.scriptNonce} />
      ))}
      {reload && <script nonce={template.scriptNonce} dangerouslySetInnerHTML={{ __html: reloadScript(reload) }} />}
    </>
  )
}
