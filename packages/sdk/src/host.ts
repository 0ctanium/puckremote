/**
 * `@puck-remote/sdk/host` — contracts for TRUSTED host plugins (they run in Node, chosen by the host
 * operator, never shipped by themes):
 *
 *  - DataSource:    where `find` / `findByID` / `global` queries go. Any database, CMS or API.
 *  - ArtifactStore: where theme artifacts (code and templates) and the site's themes are stored.
 *
 * The host core enforces each collection's declared policy (exposed fields, filter operators,
 * sorting, limits, depth, output projection) BEFORE and AFTER calling the plugin, so a plugin
 * only has to translate an already-validated, normalized query into its own storage.
 */

export type WhereOperator = 'equals' | 'in' | 'contains' | 'gt' | 'lt'
export const ALL_OPERATORS: readonly WhereOperator[] = ['equals', 'in', 'contains', 'gt', 'lt']

export interface SourceContextBase {
  locale: string
  signal: AbortSignal
}

/**
 * What a source receives with each query. With `R = true` (the source declares
 * `requireRequest: true`), `request` is the request the query runs for (a public page, a preview,
 * the editor's resolveData), as passed by the app: the source decides who it is (session cookie,
 * token…); `null` means anonymous. Sources without `requireRequest` never receive it. The request
 * is never exposed to theme code.
 */
export type SourceContext<R extends boolean = false> = R extends true ? SourceContextBase & { request: Request | null } : SourceContextBase

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

export interface CollectionDef<D = RawDoc, R extends boolean = false> {
  /** Exposed fields. Anything not listed is never selectable, filterable, sortable or returned. */
  fields: { [K in keyof D & string]?: CollectionField }
  limits?: { default?: number; max?: number; maxDepth?: number }
  find: (query: NormalizedFind, ctx: SourceContext<R>) => Promise<{ docs: RawDoc[]; totalDocs: number }>
  findByID?: (id: string, query: Pick<NormalizedFind, 'select' | 'depth'>, ctx: SourceContext<R>) => Promise<RawDoc | null>
  /** Phantom: the document type, used for typing theme queries. */
  readonly [__doc]?: D
}

export interface GlobalDef<D = RawDoc, R extends boolean = false> {
  /** Exposed fields; output is projected to these. */
  fields: { [K in keyof D & string]?: CollectionField }
  get: (ctx: SourceContext<R>) => Promise<RawDoc | null>
  readonly [__doc]?: D
}

export interface DataSource<
  C extends Record<string, CollectionDef<any, any>> = Record<string, CollectionDef<any, any>>,
  G extends Record<string, GlobalDef<any, any>> = Record<string, GlobalDef<any, any>>,
> {
  name: string
  /**
   * true: every query receives `ctx.request` (the request it runs for, or null when anonymous), and
   * templates running this source's queries are not cacheable (their result may vary per visitor).
   * Default false: the request is never passed.
   */
  requireRequest?: boolean
  collections: C
  globals: G
}

export type AnyDataSource = DataSource<Record<string, CollectionDef<any, any>>, Record<string, GlobalDef<any, any>>>

/**
 * `defineCollection<Post>()({...})`: fix the document type, infer the rest. A collection of a
 * `requireRequest: true` source reads `ctx.request` with `defineCollection<Post, true>()`.
 */
export function defineCollection<D, R extends boolean = false>() {
  return <T extends CollectionDef<D, R>>(def: T): T & CollectionDef<D, R> => def
}

export function defineGlobal<D, R extends boolean = false>() {
  return <T extends GlobalDef<D, R>>(def: T): T & GlobalDef<D, R> => def
}

/**
 * A source's collections and globals must accept the context it declares: with
 * `requireRequest: true` they may read `ctx.request`; without it, one that expects a request is a
 * type error.
 */
export function defineDataSource<
  const C extends Record<string, CollectionDef<any, R>>,
  const G extends Record<string, GlobalDef<any, R>>,
  R extends boolean = false,
  X extends object = {},
>(source: DataSource<C, G> & { requireRequest?: R } & X): DataSource<C, G> & { requireRequest?: R } & X {
  return source
}

// ---------------------------------------------------------------------------
// Artifact storage (theme code + templates) and themes
// ---------------------------------------------------------------------------

/**
 * What a theme is for, like Shopify's theme roles: `main` is the live theme (at most one),
 * `unpublished` a theme waiting to go live, `development` a developer's temporary theme
 * (`puck-remote dev`, one per device, deleted after a few days without activity).
 */
export type ThemeRole = 'main' | 'unpublished' | 'development'

export const THEME_ROLES: readonly ThemeRole[] = ['main', 'unpublished', 'development']

/**
 * A theme: a named set of files (manifest.json, bundles, assets/**, templates/**), like a Shopify
 * theme. Pushing code or saving a template changes its files; publishing makes it the `main` theme.
 */
export interface Theme {
  /** Generated by the host (12 lowercase hex characters). */
  id: string
  /** Display name (1–50 characters), not unique. */
  name: string
  role: ThemeRole
  /** Version of the theme's files: sha256 of its manifest.json. null: created, no files yet. */
  hash: string | null
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601: last push, save or rename. Development themes expire from it. */
  updatedAt: string
}

/** The stored theme list and its version (for compare-and-swap). */
export interface ThemeList {
  /** Opaque, changes on every write. */
  version: string
  themes: Theme[]
}

/** Thrown by writeThemes when the list changed since `expect` was read. */
export class ThemeConflictError extends Error {
  readonly code = 'THEME_CONFLICT'
  constructor(message = 'the theme list changed concurrently') {
    super(message)
    this.name = 'ThemeConflictError'
  }
}

/** Changes to a theme's files: files to write (or replace) and files to remove. */
export interface FileChanges {
  put?: Record<string, Uint8Array>
  delete?: string[]
}

/**
 * Stores the site's themes: the theme list, and each theme's current files (manifest.json,
 * bundles, assets/**, templates/<name>.json, like a Shopify theme). The host owns every rule
 * (roles, names, one main theme, expiry, which files a theme may have, their hashes): the store
 * only keeps the list, replaced atomically, and moves bytes. Paths are POSIX, relative, and
 * pre-validated by the host; theme ids are 12 lowercase hex characters.
 */
export interface ArtifactStore {
  /** The theme list (empty, with any version, when nothing was ever published). */
  readThemes(): Promise<ThemeList>
  /**
   * Replace the theme list atomically, only if its version is still `expect` (compare-and-swap);
   * otherwise throw ThemeConflictError. The host has validated the list.
   */
  writeThemes(themes: Theme[], opts: { expect: string }): Promise<void>
  /** A file of a theme, or null if missing. */
  readFile(theme: string, path: string): Promise<Uint8Array | null>
  /**
   * Write and remove files of a theme. Each written file must replace the old one atomically (a
   * reader never sees a partial file); the set of changes as a whole need not be atomic.
   */
  writeFiles(theme: string, changes: FileChanges): Promise<void>
  /** Copy every file of a theme to another (duplicate). */
  copyFiles(from: string, to: string): Promise<void>
  /** Remove every file of a theme (deleted theme). */
  deleteFiles(theme: string): Promise<void>
  /** Optional change feed for the theme list. Without it, the host polls readThemes(). */
  watch?(onChange: () => void): () => void
}

// ---------------------------------------------------------------------------
// Type helpers used by theme-side query builders
// ---------------------------------------------------------------------------

export type CollectionName<S extends AnyDataSource> = keyof S['collections'] & string
export type GlobalName<S extends AnyDataSource> = keyof S['globals'] & string
export type DocOf<S extends AnyDataSource, K extends string> = S['collections'][K] extends CollectionDef<infer D, any> ? D : RawDoc
export type GlobalDocOf<S extends AnyDataSource, K extends string> = S['globals'][K] extends GlobalDef<infer D, any> ? D : RawDoc

// ---------------------------------------------------------------------------
// Artifacts HTTP API (publication from the CLI)
// ---------------------------------------------------------------------------

/** What a request to the artifacts API wants to do, passed to the app's `authorize`. */
export interface ApiAction {
  kind: 'read' | 'list' | 'createTheme' | 'updateTheme' | 'publishTheme' | 'deleteTheme'
  /**
   * The theme concerned: for createTheme the requested name and role; otherwise the stored theme
   * (for publishTheme, the theme that would become main; for updateTheme, a rename or a push of
   * files). Undefined when the theme does not exist.
   */
  theme?: { id?: string; name: string; role: ThemeRole }
}

/** Decides whether a request may perform an action. Required: the API refuses everything without it. */
export type AuthorizeApi = (request: Request, action: ApiAction) => boolean | Promise<boolean>
