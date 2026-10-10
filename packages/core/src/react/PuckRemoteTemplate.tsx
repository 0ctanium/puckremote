/**
 * Public template renderer (server component; RSC-safe). Block HTML was produced in the isolate
 * by prepareTemplate; this only parses it, swaps slots and emits head assets.
 */
import { Render } from '@puckeditor/core/rsc'
import type { PreparedTemplate } from '../server/public-render.ts'
import { buildRscConfig } from '../server/puck-rsc.tsx'

export function PuckRemoteTemplate({ template }: { template: PreparedTemplate }) {
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
    </>
  )
}
