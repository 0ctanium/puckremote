/**
 * Puck config for the RSC public renderer. Built from manifest JSON only. Each component's
 * render is a synchronous host function: look up the pre-rendered HTML, parse it, swap slots.
 */
import type { Config } from '@puckeditor/core'
import { basicFields } from '../shared/fields-basic.ts'
import { htmlToReact } from '../shared/slot-swap.tsx'
import type { BlockMeta, Manifest } from './manifest-schema.ts'
import { MISSING_TYPE, ROOT_ID } from './page-tree.ts'
import type { RenderedBlock } from './public-render.ts'

type AnyProps = Record<string, any> & { id?: string; puck?: { metadata?: { rendered?: Record<string, RenderedBlock> } } }

const cache = new WeakMap<Manifest, Config>()

function Failed({ name }: { name: string }) {
  // Public pages show nothing for a failed block; the reason is logged server-side.
  return <div hidden data-block-error={name} />
}

function renderBlock(id: string, name: string, meta: BlockMeta, props: AnyProps, extraSlots: Record<string, unknown> = {}) {
  const r = props.puck?.metadata?.rendered?.[id]
  if (!r || !r.ok) return <Failed name={name} />
  const slots: Record<string, any> = { ...extraSlots }
  for (const s of meta.slots) slots[s] = props[s]
  return htmlToReact(r.html, { nonce: r.nonce, slots, allowed: [...meta.slots, ...Object.keys(extraSlots)] })
}

export function buildRscConfig(manifest: Manifest): Config {
  const hit = cache.get(manifest)
  if (hit) return hit
  const components: Config['components'] = {}
  for (const [name, meta] of Object.entries(manifest.blocks)) {
    components[name] = {
      label: meta.label,
      fields: basicFields(meta.fields),
      render: (props: AnyProps) => renderBlock(props.id!, name, meta, props),
    }
  }
  components[MISSING_TYPE] = {
    label: 'Missing block',
    render: (props: AnyProps) => <div hidden data-missing-block={String(props.originalType ?? 'unknown')} />,
  }
  const rootMeta = manifest.root
  const config: Config = {
    components,
    root: rootMeta
      ? {
          fields: basicFields(rootMeta.fields),
          render: (props: AnyProps) => renderBlock(ROOT_ID, 'root', rootMeta, props, { children: props.children }),
        }
      : { render: (props: AnyProps) => <>{props.children}</> },
  }
  cache.set(manifest, config)
  return config
}
