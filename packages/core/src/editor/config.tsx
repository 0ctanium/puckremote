/**
 * Editor Puck config, built from manifest JSON only. Component render calls the artifact
 * bundle synchronously (in a hidden iframe realm) with data from resolveData, then swaps slots
 * with the same code as the public renderer.
 */
import type { ComponentConfig, Config, Fields as PuckFields } from '@puckeditor/core'
import type { CSSProperties, ReactNode } from 'react'
import type { BlockMeta, Manifest } from '../server/manifest-schema.ts'
import { MISSING_TYPE, RESERVED_DATA_PROP, renderProps } from '../server/page-tree.ts'
import { htmlToReact } from '../shared/slot-swap.tsx'
import { mapFields } from './fields.ts'
import { isVisible } from './visible-if.ts'

export interface EditorEffect {
  kind: string
  url?: string
}

export interface EditorDeps {
  version: number
  /** Asset URL prefix for ctx.assetUrl, e.g. /theme/v3/assets/ */
  assetBase: string
  slug: string
  site: { name: string; locale: string }
  /** Synchronous render via the bundle. Returns the raw JSON string from __render. */
  render: ((kind: 'block' | 'root', name: string, propsJson: string, dataJson: string, ctxJson: string) => string) | null
  /** Data RPC. Only block type + props go over the wire. */
  resolve: (blockType: string, props: Record<string, unknown>) => Promise<Record<string, unknown>>
  newNonce: () => string
  onEffects?: (effects: EditorEffect[]) => void
  debounceMs?: number
  /** Defaults to true. The parity test renders with false to compare against public output. */
  isEditing?: boolean
}

type AnyProps = Record<string, any>

const box = (color: string): CSSProperties => ({
  padding: 12,
  border: `2px dashed ${color}`,
  borderRadius: 8,
  color,
  background: '#fff',
  font: '13px system-ui, sans-serif',
})

function Notice({ children, color = '#b45309' }: { children: ReactNode; color?: string }) {
  return <div style={{ ...box(color), borderStyle: 'solid', borderWidth: 1, padding: '4px 8px', marginBottom: 4 }}>{children}</div>
}

function pendingData(meta: BlockMeta): Record<string, unknown> {
  return Object.fromEntries(Object.keys(meta.data).map((k) => [k, { ok: false, error: 'loading' }]))
}

export function renderEditorBlock(kind: 'block' | 'root', name: string, meta: BlockMeta, props: AnyProps, deps: EditorDeps, extraSlots: Record<string, unknown> = {}): ReactNode {
  if (!deps.render) return <div style={box('#64748b')}>Loading theme bundle…</div>
  const nonce = deps.newNonce()
  const data = (props[RESERVED_DATA_PROP] as Record<string, unknown> | undefined) ?? pendingData(meta)
  const ctx = {
    isEditing: deps.isEditing ?? true,
    locale: deps.site.locale,
    nonce,
    page: { slug: deps.slug },
    site: { name: deps.site.name },
    assetBase: deps.assetBase,
  }
  let out: { html: string; effects: EditorEffect[] }
  try {
    out = JSON.parse(deps.render(kind, name, JSON.stringify(renderProps(props, meta)), JSON.stringify(data), JSON.stringify(ctx)))
  } catch (e) {
    return (
      <div style={box('#b91c1c')}>
        <strong>Block “{name}” failed to render.</strong>
        <div>{e instanceof Error ? e.message : String(e)}</div>
      </div>
    )
  }
  deps.onEffects?.(out.effects)
  const slots: Record<string, unknown> = { ...extraSlots }
  for (const s of meta.slots) slots[s] = props[s]
  const body = htmlToReact(out.html, { nonce, slots: slots as never, allowed: [...meta.slots, ...Object.keys(extraSlots)] })
  if (!meta.usesRequestParams) return body
  return (
    <>
      <Notice>⚠ This block makes the page uncacheable (it reads URL query parameters).</Notice>
      {body}
    </>
  )
}

/** Puck resolveData → props.__data (read-only, stripped on save). Re-runs only when $prop refs change. */
function makeResolveData(name: string, meta: BlockMeta, deps: EditorDeps): ComponentConfig['resolveData'] {
  const refs = [...new Set(Object.values(meta.propRefs).flat())]
  const timers = new Map<string, number>()
  return async (data, { changed, trigger }) => {
    const props = data.props as AnyProps
    const id = String(props.id ?? name)
    const hasData = !!props[RESERVED_DATA_PROP]
    const relevant = refs.some((r) => (changed as Record<string, boolean>)[r])
    if (hasData && !relevant && trigger !== 'force') return data
    if (trigger === 'replace' && hasData) {
      // Debounce keystrokes: wait, and give up if a newer edit for this block superseded us.
      const mine = (timers.get(id) ?? 0) + 1
      timers.set(id, mine)
      await new Promise((r) => setTimeout(r, deps.debounceMs ?? 300))
      if (timers.get(id) !== mine) return data
    }
    const resolved = await deps.resolve(name, renderProps(props, meta)).catch(() => pendingData(meta))
    return { props: { [RESERVED_DATA_PROP]: resolved }, readOnly: { [RESERVED_DATA_PROP]: true } } as never
  }
}

function makeResolveFields(fields: PuckFields, meta: BlockMeta): ComponentConfig['resolveFields'] | undefined {
  const conditional = Object.entries(meta.fields).filter(([, f]) => f.visibleIf)
  if (!conditional.length) return undefined
  return (data) => {
    const props = data.props as AnyProps
    return Object.fromEntries(Object.entries(fields).filter(([n]) => isVisible(meta.fields[n]?.visibleIf, props)))
  }
}

export function buildEditorConfig(manifest: Manifest, deps: EditorDeps): Config {
  const components: Config['components'] = {}
  for (const [name, meta] of Object.entries(manifest.blocks)) {
    const fields = mapFields(meta.fields)
    components[name] = {
      label: meta.label,
      fields,
      defaultProps: meta.defaultProps,
      resolveFields: makeResolveFields(fields, meta),
      resolveData: Object.keys(meta.data).length ? makeResolveData(name, meta, deps) : undefined,
      render: (props: AnyProps) => <>{renderEditorBlock('block', name, meta, props, deps)}</>,
    }
  }
  components[MISSING_TYPE] = {
    label: 'Missing block',
    fields: {},
    render: (props: AnyProps) => (
      <div style={box('#b91c1c')}>
        <strong>Missing block:</strong> “{String(props.originalType)}” is not in the current theme (v{deps.version}). It is kept as-is
        when you save.
      </div>
    ),
  }
  const categories: Config['categories'] = {}
  for (const [key, c] of Object.entries(manifest.categories)) {
    categories[key] = { title: c.title ?? key, components: c.components, defaultExpanded: c.defaultExpanded, visible: c.visible }
  }
  // The fallback is never insertable; it only stands in for unknown saved blocks.
  categories.__host = { title: 'Host', components: [MISSING_TYPE], visible: false }
  const root = manifest.root
  const rootFields = root ? mapFields(root.fields) : {}
  return {
    components,
    categories,
    root: root
      ? {
          fields: rootFields,
          defaultProps: root.defaultProps,
          // Root data has the same { props } shape at runtime; Puck types it separately.
          resolveFields: makeResolveFields(rootFields, root) as never,
          resolveData: (Object.keys(root.data).length ? makeResolveData('root', root, deps) : undefined) as never,
          render: (props: AnyProps) => <>{renderEditorBlock('root', 'root', root, props, deps, { children: props.children })}</>,
        }
      : undefined,
  }
}
