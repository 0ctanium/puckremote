/**
 * Editor Puck config, rebuilt in the iframe from the manifest (JSON: fields, defaults,
 * categories) and the theme's browser bundle (render functions). Blocks are real client
 * components here; slots are Puck's own, so drag and drop and inline editing work natively.
 */
import type { ComponentConfig, Config, Fields as PuckFields } from '@puckeditor/core'
import type { BlockMeta, Manifest } from '@puck-remote/core'
import { SlotContext } from '@puck-remote/sdk'
import type { BlockDefinition, RenderCtx, RootDefinition } from '@puck-remote/sdk'
import { Component, type CSSProperties, type ReactNode } from 'react'
import { mapFields, type HostFieldFactories } from './fields.ts'
import { isVisible } from './visible-if.ts'

/** What the theme's bundle.browser.js exports by default. */
export interface ThemeModule {
  blocks: Record<string, BlockDefinition<any, any>>
  root: RootDefinition<any, any> | null
}

// Same values as the core's page-tree (kept here so the editor bundle never imports the core).
export const MISSING_TYPE = '__missing'
export const RESERVED_DATA_PROP = '__data'

export interface EditorDeps {
  /** Render context for blocks (asset URLs, style requests). */
  ctx: RenderCtx
  /** Data for one block (the host's resolveData RPC). */
  resolve: (block: string, props: Record<string, unknown>) => Promise<Record<string, unknown>>
  debounceMs?: number
  /** Replacements for the built-in host:* field UIs. */
  hostFields?: HostFieldFactories
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

/** Props a block's render receives: no host keys, no Puck internals, no slots. */
export function renderProps(props: Record<string, unknown>, meta: BlockMeta | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('__') || k === 'puck' || k === 'editMode' || k === 'children') continue
    if (meta?.slots.includes(k)) continue
    out[k] = v
  }
  return out
}

function pendingData(meta: BlockMeta): Record<string, unknown> {
  return Object.fromEntries(Object.keys(meta.data).map((k) => [k, { ok: false, error: 'loading' }]))
}

class BlockBoundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={box('#b91c1c')}>
        <strong>Block “{this.props.name}” failed to render.</strong>
        <div>{this.state.error}</div>
      </div>
    )
  }
}

function BlockBody(p: { def: BlockDefinition<any, any> | RootDefinition<any, any>; meta: BlockMeta; props: AnyProps; ctx: RenderCtx }) {
  const data = (p.props[RESERVED_DATA_PROP] as Record<string, unknown> | undefined) ?? pendingData(p.meta)
  return <>{p.def.render({ ...p.meta.defaultProps, ...renderProps(p.props, p.meta) } as never, data as never, p.ctx)}</>
}

/** One block (or the root) in the canvas: the theme's own render, with Puck's slots. */
export function BrowserBlock(p: { name: string; def: BlockDefinition<any, any> | RootDefinition<any, any>; meta: BlockMeta; props: AnyProps; deps: EditorDeps; extraSlots?: Record<string, unknown> }) {
  const slots: Record<string, unknown> = { ...p.extraSlots }
  for (const s of p.meta.slots) slots[s] = p.props[s]
  const body = (
    <SlotContext.Provider value={slots as never}>
      <BlockBoundary name={p.name}>
        <BlockBody def={p.def} meta={p.meta} props={p.props} ctx={p.deps.ctx} />
      </BlockBoundary>
    </SlotContext.Provider>
  )
  if (!p.meta.usesRequestParams) return body
  return (
    <>
      <div style={{ ...box('#b45309'), borderStyle: 'solid', borderWidth: 1, padding: '4px 8px', marginBottom: 4 }}>⚠ This block makes the page uncacheable (it reads URL query parameters).</div>
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

export function buildEditorConfig(manifest: Manifest, theme: ThemeModule, deps: EditorDeps, categoriesOverride?: Manifest['categories']): Config {
  const components: Config['components'] = {}
  for (const [name, meta] of Object.entries(manifest.blocks)) {
    const def = Object.hasOwn(theme.blocks, name) ? theme.blocks[name] : null
    const fields = mapFields(meta.fields, deps.hostFields)
    components[name] = {
      label: meta.label,
      fields,
      defaultProps: meta.defaultProps,
      resolveFields: makeResolveFields(fields, meta),
      resolveData: Object.keys(meta.data).length ? makeResolveData(name, meta, deps) : undefined,
      render: (props: AnyProps) =>
        def ? <BrowserBlock name={name} def={def} meta={meta} props={props} deps={deps} /> : <div style={box('#b91c1c')}>Block “{name}” is missing from the theme bundle.</div>,
    }
  }
  components[MISSING_TYPE] = {
    label: 'Missing block',
    fields: {},
    render: (props: AnyProps) => (
      <div style={box('#b91c1c')}>
        <strong>Missing block:</strong> “{String(props.originalType)}” is not in this theme. It is kept as-is when you save.
      </div>
    ),
  }
  const categories: Config['categories'] = {}
  for (const [key, c] of Object.entries(categoriesOverride ?? manifest.categories)) {
    categories[key] = { title: c.title ?? key, components: c.components, defaultExpanded: c.defaultExpanded, visible: c.visible }
  }
  // The fallback is never insertable; it only stands in for unknown saved blocks.
  categories.__host = { title: 'Host', components: [MISSING_TYPE], visible: false }
  const root = manifest.root
  const rootDef = theme.root
  const rootFields = root ? mapFields(root.fields, deps.hostFields) : {}
  return {
    components,
    categories,
    root:
      root && rootDef
        ? {
            fields: rootFields,
            defaultProps: root.defaultProps,
            // Root data has the same { props } shape at runtime; Puck types it separately.
            resolveFields: makeResolveFields(rootFields, root) as never,
            resolveData: (Object.keys(root.data).length ? makeResolveData('root', root, deps) : undefined) as never,
            render: (props: AnyProps) => <BrowserBlock name="root" def={rootDef} meta={root} props={props} deps={deps} extraSlots={{ children: props.children }} />,
          }
        : undefined,
  }
}
