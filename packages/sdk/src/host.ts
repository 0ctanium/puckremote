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
// Artifact storage
// ---------------------------------------------------------------------------

/**
 * Stores published theme artifacts: immutable versions (manifest.json, bundle.js, assets/**)
 * plus a pointer to the active version. The host verifies hashes and validates manifests
 * itself, so a store only moves bytes. Paths are POSIX, relative, and pre-validated by the host.
 */
export interface ArtifactStore {
  /** Active version, or null if nothing was ever published. */
  readPointer(): Promise<number | null>
  /** Atomically switch the active version (publish and rollback). */
  writePointer(version: number): Promise<void>
  listVersions(): Promise<number[]>
  /** File bytes of a version, or null if missing. */
  readFile(version: number, path: string): Promise<Uint8Array | null>
  /** Write a complete version. Must not become visible until fully written. */
  writeVersion(version: number, files: Record<string, Uint8Array>): Promise<void>
  /** Optional change feed for the pointer. Without it, the host polls readPointer(). */
  watch?(onChange: () => void): () => void
}

// ---------------------------------------------------------------------------
// Cache storage
// ---------------------------------------------------------------------------

/** Shared cache for query results (and later rendered output). Values are JSON-serializable. */
export interface CacheStore {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown, options: { ttlMs?: number; tags?: string[] }): Promise<void>
  /** Drop every entry carrying any of these tags. */
  invalidateTags(tags: string[]): Promise<void>
}

// ---------------------------------------------------------------------------
// Authentication / authorization
// ---------------------------------------------------------------------------

/** Everything the host may ask permission for. */
export type Action =
  | 'editor:open'
  | 'page:read-draft'
  | 'page:write'
  | 'page:publish'
  | 'artifact:publish'
  | 'artifact:activate'

export const ACTIONS: readonly Action[] = ['editor:open', 'page:read-draft', 'page:write', 'page:publish', 'artifact:publish', 'artifact:activate']

/** Whoever is making the request. Adapters may attach anything under `data`. */
export interface Principal {
  id: string
  name?: string
  data?: Record<string, unknown>
}

/**
 * Framework- and backend-agnostic auth: only the standard Request is involved, so it works with
 * Payload sessions, cookies, bearer tokens, Mongo users…
 */
export interface AuthAdapter {
  /** Identify the caller, or null if anonymous. */
  authenticate(request: Request): Promise<Principal | null>
  /** Decide whether the principal may perform `action` (on `resource`, when relevant). */
  authorize(principal: Principal, action: Action, resource?: { slug?: string }): boolean | Promise<boolean>
}

export function defineAuth<A extends AuthAdapter>(auth: A): A {
  return auth
}

// ---------------------------------------------------------------------------
// Type helpers used by theme-side query builders
// ---------------------------------------------------------------------------

export type CollectionName<S extends AnyDataSource> = keyof S['collections'] & string
export type GlobalName<S extends AnyDataSource> = keyof S['globals'] & string
export type DocOf<S extends AnyDataSource, K extends string> = S['collections'][K] extends CollectionDef<infer D> ? D : RawDoc
export type GlobalDocOf<S extends AnyDataSource, K extends string> = S['globals'][K] extends GlobalDef<infer D> ? D : RawDoc
