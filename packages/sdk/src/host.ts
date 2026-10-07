/**
 * `@puck-remote/sdk/host` — contracts for TRUSTED host plugins (they run in Node, chosen by the host
 * operator, never shipped by themes):
 *
 *  - DataSource: where `find` / `findByID` / `global` queries go. Any database, CMS or API.
 *  - PageStore:  where Puck page JSON is persisted.
 *
 * The host core enforces each collection's declared policy (exposed fields, filter operators,
 * sorting, limits, depth, output projection) BEFORE and AFTER calling the plugin, so a plugin
 * only has to translate an already-validated, normalized query into its own storage.
 */

export type WhereOperator = 'equals' | 'in' | 'contains' | 'gt' | 'lt'
export const ALL_OPERATORS: readonly WhereOperator[] = ['equals', 'in', 'contains', 'gt', 'lt']

/** 'draft' is set by the host for editor requests only; never derived from theme input. */
export type Mode = 'public' | 'draft'

export interface SourceContext {
  mode: Mode
  locale: string
  signal: AbortSignal
}

export type FieldKind = 'text' | 'number' | 'boolean' | 'date' | 'json' | 'relation'

export interface CollectionField {
  type: FieldKind
  /** For relations: the target collection (its own field policy is applied to populated docs). */
  to?: string
  /** Allowed `where` operators. Default: all. `false`: not filterable. */
  filter?: readonly WhereOperator[] | false
  /** Default true. */
  sort?: boolean
}

export type NormalizedWhere =
  | { and: NormalizedWhere[] }
  | { or: NormalizedWhere[] }
  | { field: string; op: WhereOperator; value: unknown }

/** What a plugin receives: validated against the collection policy, clamped, params substituted. */
export interface NormalizedFind {
  where: NormalizedWhere | null
  sort: { field: string; direction: 'asc' | 'desc' } | null
  limit: number
  page: number
  /** Requested fields (always includes `id`), or null for all exposed fields. */
  select: string[] | null
  /** Relation population depth, already clamped to the collection's maxDepth. */
  depth: number
}

export type RawDoc = Record<string, unknown>

declare const __doc: unique symbol

export interface CollectionDef<D = RawDoc> {
  /** Exposed fields. Anything not listed is never selectable, filterable, sortable or returned. */
  fields: { [K in keyof D & string]?: CollectionField }
  limits?: { default?: number; max?: number; maxDepth?: number }
  /** Cache tags for results of this collection. Default: [`collection:<name>`]. */
  tags?: string[]
  find(query: NormalizedFind, ctx: SourceContext): Promise<{ docs: RawDoc[]; totalDocs: number }>
  findByID?(id: string, query: Pick<NormalizedFind, 'select' | 'depth'>, ctx: SourceContext): Promise<RawDoc | null>
  /** Phantom: the document type, used for typing theme queries. */
  readonly [__doc]?: D
}

export interface GlobalDef<D = RawDoc> {
  /** Exposed fields; output is projected to these. */
  fields: { [K in keyof D & string]?: CollectionField }
  tags?: string[]
  get(ctx: SourceContext): Promise<RawDoc | null>
  readonly [__doc]?: D
}

export interface DataSource<
  C extends Record<string, CollectionDef<any>> = Record<string, CollectionDef<any>>,
  G extends Record<string, GlobalDef<any>> = Record<string, GlobalDef<any>>,
> {
  name: string
  collections: C
  globals: G
  /** Optional change feed: the host invalidates its query cache for the emitted tags. */
  subscribe?(onChange: (tags: string[]) => void): () => void
}

export type AnyDataSource = DataSource<Record<string, CollectionDef<any>>, Record<string, GlobalDef<any>>>

/** `defineCollection<Post>()({...})`: fix the document type, infer the rest. */
export function defineCollection<D>() {
  return <T extends CollectionDef<D>>(def: T): T & CollectionDef<D> => def
}

export function defineGlobal<D>() {
  return <T extends GlobalDef<D>>(def: T): T & GlobalDef<D> => def
}

export function defineDataSource<const C extends Record<string, CollectionDef<any>>, const G extends Record<string, GlobalDef<any>>, X extends object = {}>(
  source: DataSource<C, G> & X,
): DataSource<C, G> & X {
  return source
}

// ---------------------------------------------------------------------------
// Page storage
// ---------------------------------------------------------------------------

/** Persists Puck page JSON. The host validates and strips resolved data before `put`. */
export interface PageStore {
  get(slug: string): Promise<unknown | null>
  put(slug: string, data: unknown): Promise<void>
  list(): Promise<string[]>
}

// ---------------------------------------------------------------------------
// Type helpers used by theme-side query builders
// ---------------------------------------------------------------------------

export type CollectionName<S extends AnyDataSource> = keyof S['collections'] & string
export type GlobalName<S extends AnyDataSource> = keyof S['globals'] & string
export type DocOf<S extends AnyDataSource, K extends string> = S['collections'][K] extends CollectionDef<infer D> ? D : RawDoc
export type GlobalDocOf<S extends AnyDataSource, K extends string> = S['globals'][K] extends GlobalDef<infer D> ? D : RawDoc
