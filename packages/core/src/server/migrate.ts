/**
 * Content migrations (D-0068): saved items carry their block version in `props.__v` (missing =
 * 1). Items older than the theme's block version are upgraded by the theme's own migrations,
 * which run in the sandbox (`__migrate`). The host keeps `id`, re-attaches slot content and owns
 * every `__` key, so a migration only ever sees and returns field values.
 */
import { z } from 'zod'
import type { BlockMeta, Manifest } from './manifest-schema.ts'
import { mapItems, MISSING_TYPE, ROOT_ID, type PageData, type PuckItem } from './page-tree.ts'
import type { RenderSession } from './runtime/types.ts'

export const VERSION_PROP = '__v'

const resultSchema = z.strictObject({ props: z.record(z.string(), z.unknown()), version: z.number().int().min(1) })

export interface MigrationResult {
  data: PageData
  /** Item id (ROOT_ID for the root) → error, for items whose migration failed (left unmigrated). */
  failed: Map<string, { block: string; error: string }>
}

const savedVersion = (props: Record<string, unknown>) => {
  const v = props[VERSION_PROP]
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1
}

/** Field values only: no id, no slot content, no host keys. */
function fieldProps(props: Record<string, unknown>, meta: BlockMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (k === 'id' || k.startsWith('__') || meta.slots.includes(k)) continue
    out[k] = v
  }
  return out
}

/**
 * Migrate every outdated item (root, content, slot content). Every known item comes back with
 * an explicit `__v`: the new version, or the version it really has when it was left as is
 * (failed, or saved by a newer theme). A session is only opened if something needs migrating.
 */
export async function migratePage(
  data: PageData,
  manifest: Manifest,
  session: () => Promise<RenderSession>,
  log: Pick<Console, 'warn' | 'error'> = console,
): Promise<MigrationResult> {
  const failed: MigrationResult['failed'] = new Map()

  async function upgrade(kind: 'block' | 'root', name: string, id: string, props: Record<string, unknown>, meta: BlockMeta): Promise<Record<string, unknown>> {
    const from = savedVersion(props)
    if (from > meta.version) {
      log.warn(`[migrate] ${name}#${id} was saved with version ${from}, newer than the theme's ${meta.version}; rendering it as is`)
      return { ...props, [VERSION_PROP]: from }
    }
    if (from === meta.version) return { ...props, [VERSION_PROP]: from }
    const res = await (await session()).call('__migrate', [kind, name, JSON.stringify(fieldProps(props, meta)), String(from)])
    let error: string | null = null
    let out: z.infer<typeof resultSchema> | null = null
    if (!res.ok) error = res.error
    else {
      try {
        const parsed = resultSchema.safeParse(JSON.parse(res.value))
        if (parsed.success && parsed.data.version === meta.version) out = parsed.data
        else error = 'invalid migration output'
      } catch {
        error = 'migration output is not JSON'
      }
    }
    if (!out) {
      failed.set(id, { block: name, error: error! })
      return { ...props, [VERSION_PROP]: from }
    }
    // Host-owned keys come from the saved item, never from the migration.
    const kept: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) if (k === 'id' || meta.slots.includes(k)) kept[k] = v
    const fields = fieldProps(out.props, meta)
    return { ...fields, ...kept, [VERSION_PROP]: meta.version }
  }

  async function walk(items: unknown): Promise<unknown> {
    if (!Array.isArray(items)) return items
    const out = []
    for (const item of items as PuckItem[]) {
      if (!item || typeof item !== 'object' || typeof item.type !== 'string' || !item.props) {
        out.push(item)
        continue
      }
      const meta = item.type !== MISSING_TYPE && Object.hasOwn(manifest.blocks, item.type) ? manifest.blocks[item.type] : null
      if (!meta) {
        out.push(item)
        continue
      }
      const id = String(item.props.id ?? '')
      let props = await upgrade('block', item.type, id, item.props, meta)
      for (const slot of meta.slots) if (Array.isArray(props[slot])) props = { ...props, [slot]: await walk(props[slot]) }
      out.push({ ...item, props })
    }
    return out
  }

  let root = data.root
  if (manifest.root) root = { ...data.root, props: await upgrade('root', 'root', ROOT_ID, data.root?.props ?? {}, manifest.root) }
  const content = (await walk(data.content)) as PuckItem[]
  return { data: { ...data, root, content }, failed }
}

/** Saving editor data: items without `__v` were created with the current theme, so stamp them. */
export function stampVersions(data: PageData, manifest: Manifest): PageData {
  const stamp = (props: Record<string, unknown>, meta: BlockMeta | null) =>
    meta && typeof props[VERSION_PROP] !== 'number' ? { ...props, [VERSION_PROP]: meta.version } : props
  const mapped = mapItems(data, manifest, (item) => ({ ...item, props: stamp(item.props, Object.hasOwn(manifest.blocks, item.type) ? manifest.blocks[item.type] : null) }))
  return { ...mapped, root: { ...data.root, props: stamp(data.root?.props ?? {}, manifest.root) } }
}
