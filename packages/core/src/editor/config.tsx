/**
 * Editor Puck config, built from manifest JSON only. Blocks are rendered BY THE SERVER (same
 * isolate pipeline as the public site) via a batched render RPC: theme code never executes in the
 * editor's origin. Slots are swapped client-side with the same code as the public renderer.
 */
import type { ComponentConfig, Config, Fields as PuckFields } from '@puckeditor/core'
import type { CSSProperties, ReactNode } from 'react'
import type { BlockMeta, Manifest } from '../server/manifest-schema.ts'
import { MISSING_TYPE, RESERVED_DATA_PROP, renderProps } from '../server/page-tree.ts'
import { htmlToReact } from '../shared/slot-swap.tsx'
import { mapFields } from './fields.ts'
import { useRemoteRender, type EditorEffect, type RemoteRenderer } from './remote-render.ts'
import { isVisible } from './visible-if.ts'

export type { EditorEffect }

export interface EditorDeps {
  version: number
  slug: string
  site: { name: string; locale: string }
  /** Server-side block rendering (batched, cached). */
  renderer: RemoteRenderer
  /** Data RPC. Only block type + props go over the wire. */
  resolve: (blockType: string, props: Record<string, unknown>) => Promise<Record<string, unknown>>
  onEffects?: (effects: EditorEffect[]) => void
  debounceMs?: number
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

/** One block (or the root) in the canvas: server-rendered HTML + client-side slot swap. */
export function RemoteBlock(p: { kind: 'block' | 'root'; name: string; meta: BlockMeta; props: AnyProps; deps: EditorDeps; extraSlots?: Record<string, unknown> }) {
  const { kind, name, meta, props, deps, extraSlots = {} } = p
  const data = (props[RESERVED_DATA_PROP] as Record<string, unknown> | undefined) ?? pendingData(meta)
  const result = useRemoteRender(deps.renderer, { kind, name, props: renderProps(props, meta), data }, deps.debounceMs ?? 150)
  if (!result) return <div style={box('#64748b')}>Rendering “{meta.label}”…</div>
  if (!result.ok) {
    return (
      <div style={box('#b91c1c')}>
        <strong>Block “{name}” failed to render.</strong>
        <div>{result.error}</div>
      </div>
    )
  }
  deps.onEffects?.(result.effects)
  const slots: Record<string, unknown> = { ...extraSlots }
  for (const s of meta.slots) slots[s] = props[s]
  const body = htmlToReact(result.html, { nonce: result.nonce, slots: slots as never, allowed: [...meta.slots, ...Object.keys(extraSlots)] })
  if (!meta.usesRequestParams) return <>{body}</>
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
      render: (props: AnyProps) => <RemoteBlock kind="block" name={name} meta={meta} props={props} deps={deps} />,
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
          render: (props: AnyProps) => <RemoteBlock kind="root" name="root" meta={root} props={props} deps={deps} extraSlots={{ children: props.children }} />,
        }
      : undefined,
  }
}
