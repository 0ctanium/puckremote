/**
 * Host-side enforcement around a pluggable DataSource (@puck-remote/sdk/host). Whatever backend the
 * operator plugs in, theme queries only ever reach it:
 *  - for declared collections/globals,
 *  - selecting/filtering/sorting declared fields with allowed operators,
 *  - with limit/depth clamped to the collection's limits,
 *  - with the mode chosen by the host ('draft' only for editor requests),
 * and results are projected back to declared fields (recursively for populated relations).
 */
import { ALL_OPERATORS, type AnyDataSource, type CollectionDef, type CollectionField, type Mode, type NormalizedFind, type NormalizedWhere, type RawDoc } from '@puck-remote/sdk/host'
import { QueryError } from './params.ts'

const DEFAULT_LIMIT = 10
const DEFAULT_MAX_LIMIT = 100

export interface HostQueryContext {
  mode: Mode
  locale: string
  signal: AbortSignal
}

export class HostSource {
  constructor(readonly source: AnyDataSource) {}

  private collection(name: string): CollectionDef<any> {
    if (typeof name !== 'string' || !Object.hasOwn(this.source.collections, name)) throw new QueryError('forbidden', `collection "${name}" is not exposed`)
    return this.source.collections[name]
  }

  private field(c: CollectionDef<any>, collection: string, name: string): CollectionField | null {
    if (name === 'id') return { type: 'text', filter: ['equals', 'in'] }
    const f = Object.hasOwn(c.fields, name) ? (c.fields as Record<string, CollectionField | undefined>)[name] : undefined
    if (!f) throw new QueryError('forbidden', `field "${collection}.${name}" is not exposed`)
    return f
  }

  tagsFor(spec: { op: string; collection?: string; slug?: string }): string[] {
    if (spec.op === 'global') return this.source.globals[spec.slug!]?.tags ?? [`global:${spec.slug}`]
    return this.source.collections[spec.collection!]?.tags ?? [`collection:${spec.collection}`]
  }

  private normalizeWhere(c: CollectionDef<any>, collection: string, w: unknown): NormalizedWhere | null {
    if (w === undefined || w === null) return null
    if (typeof w !== 'object' || Array.isArray(w)) throw new QueryError('invalid-where')
    const parts: NormalizedWhere[] = []
    for (const [k, cond] of Object.entries(w as Record<string, unknown>)) {
      if (k === 'and' || k === 'or') {
        if (!Array.isArray(cond)) throw new QueryError('invalid-where')
        const sub = cond.map((x) => this.normalizeWhere(c, collection, x)).filter((x): x is NormalizedWhere => !!x)
        parts.push(k === 'and' ? { and: sub } : { or: sub })
        continue
      }
      const f = this.field(c, collection, k)!
      const [op, value] = Object.entries((cond ?? {}) as Record<string, unknown>)[0] ?? []
      const allowed = f.filter === false ? [] : (f.filter ?? ALL_OPERATORS)
      if (!allowed.includes(op as never)) throw new QueryError('forbidden', `operator "${op}" is not allowed on "${collection}.${k}"`)
      parts.push({ field: k, op: op as NormalizedWhere extends { op: infer O } ? O : never, value })
    }
    return parts.length === 1 ? parts[0] : { and: parts }
  }

  private normalizeSelect(c: CollectionDef<any>, collection: string, select: unknown): string[] | null {
    if (select === undefined || select === null) return null
    if (!Array.isArray(select)) throw new QueryError('invalid-select')
    for (const f of select) if (typeof f !== 'string') throw new QueryError('invalid-select')
    for (const f of select) this.field(c, collection, f)
    return [...new Set(['id', ...(select as string[])])]
  }

  private clampDepth(c: CollectionDef<any>, depth: unknown): number {
    const d = typeof depth === 'number' && Number.isFinite(depth) ? Math.floor(depth) : 0
    return Math.min(Math.max(d, 0), c.limits?.maxDepth ?? 0)
  }

  /** Output projection: declared fields only; populated relations use the target's policy. */
  private project(collection: string, doc: RawDoc, select: string[] | null, depth: number): RawDoc {
    const c = this.collection(collection)
    const names = select ?? ['id', ...Object.keys(c.fields)]
    const out: RawDoc = {}
    for (const name of names) {
      if (!Object.hasOwn(doc, name)) continue
      const f = name === 'id' ? null : (c.fields as Record<string, CollectionField | undefined>)[name]
      const v = doc[name]
      if (f?.type === 'relation' && v && typeof v === 'object' && !Array.isArray(v)) {
        // Only keep a populated relation if depth allows it and the target is exposed.
        out[name] = depth > 0 && f.to && Object.hasOwn(this.source.collections, f.to) ? this.project(f.to, v as RawDoc, null, depth - 1) : ((v as RawDoc).id ?? null)
      } else out[name] = v
    }
    return out
  }

  async find(collection: string, args: Record<string, unknown>, ctx: HostQueryContext) {
    const c = this.collection(collection)
    let sort: NormalizedFind['sort'] = null
    if (args.sort !== undefined) {
      if (typeof args.sort !== 'string') throw new QueryError('invalid-sort')
      const desc = args.sort.startsWith('-')
      const field = desc ? args.sort.slice(1) : args.sort
      if (this.field(c, collection, field)!.sort === false) throw new QueryError('forbidden', `"${collection}.${field}" is not sortable`)
      sort = { field, direction: desc ? 'desc' : 'asc' }
    }
    const max = c.limits?.max ?? DEFAULT_MAX_LIMIT
    const rawLimit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : (c.limits?.default ?? DEFAULT_LIMIT)
    const query: NormalizedFind = {
      where: this.normalizeWhere(c, collection, args.where),
      sort,
      limit: Math.min(Math.max(rawLimit, 1), max),
      page: typeof args.page === 'number' && args.page >= 1 ? Math.floor(args.page) : 1,
      select: this.normalizeSelect(c, collection, args.select),
      depth: this.clampDepth(c, args.depth),
    }
    const res = await c.find(query, ctx)
    return {
      docs: res.docs.slice(0, query.limit).map((d) => this.project(collection, d, query.select, query.depth)),
      totalDocs: res.totalDocs,
      limit: query.limit,
    }
  }

  async findByID(collection: string, id: unknown, args: Record<string, unknown>, ctx: HostQueryContext) {
    const c = this.collection(collection)
    if (typeof id !== 'string' || !id) return null
    const select = this.normalizeSelect(c, collection, args.select)
    const depth = this.clampDepth(c, args.depth)
    const doc = c.findByID ? await c.findByID(id, { select, depth }, ctx) : (await c.find({ where: { field: 'id', op: 'equals', value: id }, sort: null, limit: 1, page: 1, select, depth }, ctx)).docs[0]
    return doc ? this.project(collection, doc, select, depth) : null
  }

  async global(slug: string, ctx: HostQueryContext) {
    if (typeof slug !== 'string' || !Object.hasOwn(this.source.globals, slug)) throw new QueryError('forbidden', `global "${slug}" is not exposed`)
    const g = this.source.globals[slug]
    const doc = await g.get(ctx)
    if (!doc) return null
    const out: RawDoc = {}
    for (const k of Object.keys(g.fields)) if (Object.hasOwn(doc, k)) out[k] = doc[k]
    return out
  }
}
