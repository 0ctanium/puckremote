/**
 * `@puck-remote/sdk/host` — contracts for TRUSTED host plugins (they run in Node, chosen by the host
 * operator, never shipped by themes):
 *
 *  - DataSource:    where `find` / `findByID` / `global` queries go. Any database, CMS or API.
 *  - ArtifactStore: where theme artifacts (code and pages) are stored.
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
  find(query: NormalizedFind, ctx: SourceContext): Promise<{ docs: RawDoc[]; totalDocs: number }>
  findByID?(id: string, query: Pick<NormalizedFind, 'select' | 'depth'>, ctx: SourceContext): Promise<RawDoc | null>
  /** Phantom: the document type, used for typing theme queries. */
  readonly [__doc]?: D
}

export interface GlobalDef<D = RawDoc> {
  /** Exposed fields; output is projected to these. */
  fields: { [K in keyof D & string]?: CollectionField }
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
// Artifact storage (theme code + pages)
// ---------------------------------------------------------------------------

/** Opaque artifact id, chosen by the store (a content hash, a counter, a database key…). */
export type ArtifactId = string

/**
 * Stores theme artifacts: immutable sets of files (manifest.json, bundles, assets/**, and the
 * theme's pages as pages/<slug>.json, like a Shopify theme) plus a pointer to the current one.
 * The host verifies hashes and validates manifests itself, so a store only moves bytes. Paths
 * are POSIX, relative, and pre-validated by the host.
 */
export interface ArtifactStore {
  /** Current artifact, or null if nothing was ever published. */
  readPointer(): Promise<ArtifactId | null>
  /** Atomically switch the current artifact (going live, rollback). */
  writePointer(id: ArtifactId): Promise<void>
  list(): Promise<ArtifactId[]>
  /** File bytes of an artifact, or null if missing. */
  readFile(id: ArtifactId, path: string): Promise<Uint8Array | null>
  /** Store a complete artifact and return its id. Must not become visible until fully written. */
  writeArtifact(files: Record<string, Uint8Array>): Promise<ArtifactId>
  /** Optional change feed for the pointer. Without it, the host polls readPointer(). */
  watch?(onChange: () => void): () => void
}

// ---------------------------------------------------------------------------
// Type helpers used by theme-side query builders
// ---------------------------------------------------------------------------

export type CollectionName<S extends AnyDataSource> = keyof S['collections'] & string
export type GlobalName<S extends AnyDataSource> = keyof S['globals'] & string
export type DocOf<S extends AnyDataSource, K extends string> = S['collections'][K] extends CollectionDef<infer D> ? D : RawDoc
export type GlobalDocOf<S extends AnyDataSource, K extends string> = S['globals'][K] extends GlobalDef<infer D> ? D : RawDoc
