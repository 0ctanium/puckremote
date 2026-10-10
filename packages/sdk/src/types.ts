import type { ReactNode } from 'react'
import type { RegisteredRootProps } from './index.ts'

// ---------------------------------------------------------------------------
// Fields (JSON only; no functions anywhere)
// ---------------------------------------------------------------------------

export type VisibleIf =
  | { field: string; eq: JsonPrimitive }
  | { field: string; in: JsonPrimitive[] }
  | { field: string; not: JsonPrimitive }
  | { and: VisibleIf[] }
  | { or: VisibleIf[] }

type JsonPrimitive = string | number | boolean | null

interface BaseField {
  label?: string
  visibleIf?: VisibleIf
}

export interface TextField extends BaseField { type: 'text'; placeholder?: string }
export interface TextareaField extends BaseField { type: 'textarea'; placeholder?: string }
export interface NumberField extends BaseField { type: 'number'; min?: number; max?: number; step?: number }
export interface Option<V extends JsonPrimitive = JsonPrimitive> { label: string; value: V }
export interface SelectField<V extends JsonPrimitive = JsonPrimitive> extends BaseField { type: 'select'; options: readonly Option<V>[] }
export interface RadioField<V extends JsonPrimitive = JsonPrimitive> extends BaseField { type: 'radio'; options: readonly Option<V>[] }
export interface ArrayField<F extends Fields = Fields> extends BaseField {
  type: 'array'
  arrayFields: F
  /** Name of a sub-field whose value labels each item in the editor. */
  itemSummary?: string
  defaultItemProps?: Partial<PropsOf<F>>
  min?: number
  max?: number
}
export interface ObjectField<F extends Fields = Fields> extends BaseField { type: 'object'; objectFields: F }
export interface SlotField extends BaseField { type: 'slot'; allow?: string[]; disallow?: string[] }
export interface ColorField extends BaseField { type: 'host:color' }
export interface MediaField extends BaseField { type: 'host:media' }
export interface LinkField extends BaseField { type: 'host:link' }

export type Field =
  | TextField
  | TextareaField
  | NumberField
  | SelectField<any>
  | RadioField<any>
  | ArrayField<any>
  | ObjectField<any>
  | SlotField
  | ColorField
  | MediaField
  | LinkField

export type Fields = Record<string, Field>

export interface MediaValue { url: string; alt?: string }
export interface LinkValue { href: string; label?: string; newTab?: boolean }

type ValueOf<F> =
  F extends TextField | TextareaField | ColorField ? string
  : F extends NumberField ? number
  : F extends SelectField<infer V> | RadioField<infer V> ? V
  : F extends ArrayField<infer S> ? PropsOf<S>[]
  : F extends ObjectField<infer S> ? PropsOf<S>
  : F extends MediaField ? MediaValue
  : F extends LinkField ? LinkValue
  : unknown

/** Props handed to `render`. Slot fields are omitted: render them with <Slot name=…/>. */
export type PropsOf<F extends Fields> = {
  [K in keyof F as F[K] extends SlotField ? never : K]: ValueOf<F[K]>
}

// ---------------------------------------------------------------------------
// Query descriptors (pure JSON, resolved by the host)
// ---------------------------------------------------------------------------

export type PropRef = { $prop: string }
export type TemplateRef = { $template: 'name' | 'locale' }
/** A param the app passed to loadTemplate (e.g. a product handle); null when absent. */
export type ParamsRef = { $params: string }
export type SiteRef = { $site: 'locale' | 'name' }
export type QueryRef = { $query: string }
export type SecretRef = { $secret: string }
export type ParamRef = PropRef | TemplateRef | ParamsRef | SiteRef | QueryRef

export type Param = JsonPrimitive | ParamRef
export type ParamValue = Param | Param[] | { [k: string]: ParamValue }

export type WhereClause =
  | { and: WhereClause[] }
  | { or: WhereClause[] }
  | { [field: string]: WhereCondition }

export type WhereCondition =
  | { equals: Param }
  | { in: Param[] | ParamRef }
  | { contains: Param }
  | { gt: Param }
  | { lt: Param }

export interface FindArgs<D = Doc, Sel extends readonly string[] | undefined = readonly string[] | undefined> {
  where?: WhereClause
  limit?: number | ParamRef
  sort?: (keyof D & string) | `-${keyof D & string}`
  select?: Sel
  depth?: number
  page?: number | ParamRef
}

declare const __result: unique symbol
/** A JSON query descriptor. `T` is a phantom type for the resolved data. */
export type QuerySpec<T = unknown> = QueryDescriptor & { readonly [__result]?: T }

export type QueryDescriptor =
  | { source: 'host'; op: 'find'; collection: string; args: FindArgs<any, any> }
  | { source: 'host'; op: 'findByID'; collection: string; id: string | ParamRef; args: { select?: readonly string[]; depth?: number } }
  | { source: 'host'; op: 'global'; slug: string }
  | { source: 'adapter'; adapter: string; op: string; params: Record<string, ParamValue> }
  | {
      source: 'http'
      origin: string
      path: string
      method: 'GET' | 'POST'
      params: Record<string, ParamValue>
      headers: Record<string, string | SecretRef>
    }

export type Doc = Record<string, any>
export interface FindResult<T = Doc> {
  docs: T[]
  totalDocs: number
  limit: number
}

export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: string }

export type DataSpecs = Record<string, QuerySpec<any>>
export type DataOf<D extends DataSpecs | undefined> = D extends DataSpecs
  ? { [K in keyof D]: D[K] extends QuerySpec<infer T> ? QueryResult<T> : never }
  : Record<string, never>

// ---------------------------------------------------------------------------
// Render context
// ---------------------------------------------------------------------------

export interface ScriptOptions {
  defer?: boolean
  async?: boolean
  module?: boolean
}

export interface RenderCtx {
  isEditing: boolean
  locale: string
  nonce: string
  template: { name: string }
  /** Params the app passed for this template (e.g. { handle }). */
  params: Readonly<Record<string, string>>
  site: { name: string }
  assetUrl(path: string): string
  assets: {
    script(url: string, opts?: ScriptOptions): void
    style(url: string): void
  }
}

/** JSON part of the ctx the host passes in; functions are attached inside the isolate. */
export interface CtxInput {
  isEditing: boolean
  locale: string
  nonce: string
  template: { name: string }
  params: Record<string, string>
  site: { name: string }
  assetBase: string
  /** Versions of the theme's assets (path below assets/ → v), appended as `?v=` by assetUrl. */
  assetVersions?: Record<string, string>
}

export type Effect =
  | { kind: 'script'; url: string; opts: ScriptOptions }
  | { kind: 'style'; url: string }

/** One island (an export of a "use client" module) rendered in the isolate. */
export interface IslandRecord {
  /** Marker key, unique within the block render. */
  key: string
  /** "<theme-relative path>#<export>". */
  id: string
  props: Record<string, unknown>
  hydrate: HydrateMode
  /** Server render of the component, hydrated in the browser. */
  html: string
}

export type HydrateMode = 'load' | 'idle' | 'visible'

export interface RenderOutput {
  html: string
  effects: Effect[]
  islands: IslandRecord[]
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export interface BlockDefinition<F extends Fields = Fields, D extends DataSpecs | undefined = DataSpecs | undefined> {
  label?: string
  category?: string
  fields: F
  defaultProps?: Partial<PropsOf<F>>
  data?: D
  render: (props: PropsOf<F>, data: DataOf<D>, ctx: RenderCtx) => ReactNode
}

export interface RootDefinition<F extends Fields = Fields, D extends DataSpecs | undefined = DataSpecs | undefined> {
  fields: F
  defaultProps?: Partial<PropsOf<F>>
  data?: D
  /** Props: the theme's root fields plus the app's (typed by `Register.rootProps`). */
  render: (props: PropsOf<F> & RegisteredRootProps, data: DataOf<D>, ctx: RenderCtx) => ReactNode
}

/** Props of an app's root fields, for `Register.rootProps`: `RootPropsOf<typeof rootFields>`. */
export type RootPropsOf<F extends Fields> = PropsOf<F>

export interface AdapterRequest {
  method: 'GET' | 'POST'
  path: string
  params?: Record<string, ParamValue>
  headers?: Record<string, string | SecretRef>
}

export interface AdapterDefinition {
  name: string
  origin: string
  toRequest(query: { op: string; params: Record<string, unknown> }): AdapterRequest
  fromResponse(json: unknown, query: { op: string; params: Record<string, unknown> }): unknown
}

export type Categories = Record<
  string,
  { title?: string; components?: string[]; defaultExpanded?: boolean; visible?: boolean }
>
