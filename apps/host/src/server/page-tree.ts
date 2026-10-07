/**
 * Host-owned traversal of Puck page data (root → content → slot content, depth-first, in
 * order). Used instead of resolveAllData so data can be planned for the whole page at once.
 */
import type { BlockMeta, Manifest } from './manifest-schema.ts'

export interface PuckItem {
  type: string
  props: Record<string, unknown> & { id?: string }
  readOnly?: Record<string, boolean>
}

export interface PageData {
  root: { props?: Record<string, unknown>; readOnly?: Record<string, boolean> }
  content: PuckItem[]
  zones?: Record<string, PuckItem[]>
}

export interface Instance {
  id: string
  kind: 'block' | 'root'
  name: string
  props: Record<string, unknown>
  meta: BlockMeta | null
}

export const ROOT_ID = 'root'
export const MISSING_TYPE = '__missing'
export const RESERVED_DATA_PROP = '__data'

const isItem = (v: unknown): v is PuckItem =>
  !!v && typeof v === 'object' && typeof (v as PuckItem).type === 'string' && !!(v as PuckItem).props && typeof (v as PuckItem).props === 'object'

/** Props as the isolate should see them: no slot content, no host-reserved keys. */
export function renderProps(props: Record<string, unknown>, meta: BlockMeta | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('__') || k === 'puck' || k === 'editMode' || k === 'children') continue
    if (meta?.slots.includes(k)) continue
    out[k] = v
  }
  return out
}

export function collectInstances(data: PageData, manifest: Manifest): Instance[] {
  const out: Instance[] = []
  if (manifest.root) out.push({ id: ROOT_ID, kind: 'root', name: 'root', props: data.root?.props ?? {}, meta: manifest.root })
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (!isItem(item)) continue
      const meta = Object.hasOwn(manifest.blocks, item.type) ? manifest.blocks[item.type] : null
      out.push({ id: String(item.props.id ?? ''), kind: 'block', name: item.type, props: item.props, meta })
      // Recurse into slot props. Unknown blocks: recurse into anything that looks like content
      // so nested known blocks still resolve.
      for (const [k, v] of Object.entries(item.props)) {
        if (meta ? meta.slots.includes(k) : Array.isArray(v) && v.every(isItem)) walk(v)
      }
    }
  }
  walk(data.content)
  return out
}

/** Map every item in the tree (content + slots), bottom-up. */
export function mapItems(data: PageData, manifest: Manifest | null, fn: (item: PuckItem) => PuckItem): PageData {
  const mapList = (items: unknown): unknown =>
    Array.isArray(items)
      ? items.map((item) => {
          if (!isItem(item)) return item
          const props: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(item.props)) {
            props[k] = Array.isArray(v) && v.length > 0 && v.every(isItem) ? mapList(v) : v
          }
          return fn({ ...item, props })
        })
      : items
  void manifest
  return { ...data, content: mapList(data.content) as PuckItem[] }
}
