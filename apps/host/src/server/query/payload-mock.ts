/**
 * Stand-in for a real Payload Local API call with `overrideAccess: false`. Enforces the host's
 * collection/field allowlist, clamps limit/depth, and applies a public-only access filter unless
 * the HOST sets mode 'draft' (editor requests only; never derived from block input).
 */
import { readFileSync } from 'node:fs'
import type { CollectionPolicy, HostConfig } from '../config.ts'
import { QueryError } from './params.ts'

export type Mode = 'public' | 'draft'
type Doc = Record<string, unknown>

interface Data {
  collections: Record<string, Doc[]>
  globals: Record<string, Doc>
}

export interface FindArgs {
  where?: unknown
  limit?: unknown
  sort?: unknown
  select?: unknown
  depth?: unknown
  page?: unknown
}

export class PayloadMock {
  private data: Data

  constructor(
    private readonly policy: HostConfig['payload'],
    source: string | Data,
  ) {
    this.data = typeof source === 'string' ? JSON.parse(readFileSync(source, 'utf8')) : structuredClone(source)
  }

  /** Test helper standing in for "a document changed in Payload". */
  upsert(collection: string, doc: Doc): void {
    const list = (this.data.collections[collection] ??= [])
    const i = list.findIndex((d) => d.id === doc.id)
    if (i >= 0) list[i] = doc
    else list.push(doc)
  }

  tagFor(collection: string): string {
    return this.collectionPolicy(collection).tag
  }

  private collectionPolicy(collection: string): CollectionPolicy {
    if (!Object.hasOwn(this.policy.collections, collection)) throw new QueryError('forbidden', `collection "${collection}" is not exposed to blocks`)
    return this.policy.collections[collection]
  }

  private allowedField(p: CollectionPolicy, field: string): boolean {
    return field === 'id' || p.fields.includes(field)
  }

  private visible(p: CollectionPolicy, doc: Doc, mode: Mode): boolean {
    return mode === 'draft' || doc[p.publicWhen.field] === p.publicWhen.equals
  }

  private project(p: CollectionPolicy, doc: Doc, select: string[] | null): Doc {
    const fields = select ?? ['id', ...p.fields]
    const out: Doc = {}
    for (const f of fields) if (Object.hasOwn(doc, f)) out[f] = doc[f]
    return out
  }

  private matches(p: CollectionPolicy, doc: Doc, where: unknown): boolean {
    if (where === undefined || where === null) return true
    if (typeof where !== 'object' || Array.isArray(where)) throw new QueryError('invalid-where')
    return Object.entries(where as Record<string, unknown>).every(([k, cond]) => {
      if (k === 'and') return (cond as unknown[]).every((c) => this.matches(p, doc, c))
      if (k === 'or') return (cond as unknown[]).some((c) => this.matches(p, doc, c))
      if (!this.allowedField(p, k)) throw new QueryError('forbidden', `field "${k}" is not exposed`)
      const [op, val] = Object.entries(cond as Record<string, unknown>)[0] ?? []
      const v = doc[k]
      switch (op) {
        case 'equals':
          return v === val
        case 'in':
          return Array.isArray(val) && val.includes(v)
        case 'contains':
          // A null param (e.g. missing ?q=) matches everything, like an empty search.
          return val === null || (typeof v === 'string' && typeof val === 'string' && v.toLowerCase().includes(val.toLowerCase()))
        case 'gt':
          return (v as number | string) > (val as number | string)
        case 'lt':
          return (v as number | string) < (val as number | string)
        default:
          throw new QueryError('invalid-where', `unsupported operator ${op}`)
      }
    })
  }

  find(collection: string, args: FindArgs, mode: Mode): { docs: Doc[]; totalDocs: number; limit: number } {
    const p = this.collectionPolicy(collection)
    let select: string[] | null = null
    if (args.select !== undefined) {
      if (!Array.isArray(args.select)) throw new QueryError('invalid-select')
      for (const f of args.select) if (typeof f !== 'string' || !this.allowedField(p, f)) throw new QueryError('forbidden', `field "${f}" is not exposed`)
      select = args.select as string[]
    }
    const rawLimit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 10
    const limit = Math.min(Math.max(rawLimit, 1), p.maxLimit)
    // Depth is clamped; the mock has no relationships to populate, but a real source would.
    void Math.min(Math.max(typeof args.depth === 'number' ? args.depth : 0, 0), p.maxDepth)
    let docs = (this.data.collections[collection] ?? []).filter((d) => this.visible(p, d, mode) && this.matches(p, d, args.where))
    if (args.sort !== undefined) {
      if (typeof args.sort !== 'string') throw new QueryError('invalid-sort')
      const desc = args.sort.startsWith('-')
      const field = desc ? args.sort.slice(1) : args.sort
      if (!this.allowedField(p, field)) throw new QueryError('forbidden', `field "${field}" is not exposed`)
      docs = [...docs].sort((a, b) => ((a[field] as string) > (b[field] as string) ? 1 : (a[field] as string) < (b[field] as string) ? -1 : 0) * (desc ? -1 : 1))
    }
    const page = typeof args.page === 'number' && args.page > 0 ? Math.floor(args.page) : 1
    const slice = docs.slice((page - 1) * limit, page * limit)
    return { docs: slice.map((d) => this.project(p, d, select)), totalDocs: docs.length, limit }
  }

  findByID(collection: string, id: unknown, mode: Mode): Doc | null {
    const p = this.collectionPolicy(collection)
    if (typeof id !== 'string') return null
    const doc = (this.data.collections[collection] ?? []).find((d) => d.id === id)
    return doc && this.visible(p, doc, mode) ? this.project(p, doc, null) : null
  }

  global(slug: string): Doc {
    if (!this.policy.globals.includes(slug) || !Object.hasOwn(this.data.globals, slug)) throw new QueryError('forbidden', `global "${slug}" is not exposed`)
    return structuredClone(this.data.globals[slug])
  }
}
