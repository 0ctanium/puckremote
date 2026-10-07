import { createElement, type ReactElement } from 'react'
import type { AnyDataSource, CollectionName, DocOf, GlobalDocOf, GlobalName } from './host.ts'
import { renderState } from './state.ts'
import type {
  AdapterDefinition,
  BlockDefinition,
  Categories,
  DataSpecs,
  Fields,
  FindArgs,
  FindResult,
  ParamRef,
  ParamValue,
  QuerySpec,
  RootDefinition,
  SecretRef,
} from './types.ts'

export type * from './types.ts'

export function defineBlock<const F extends Fields, const D extends DataSpecs | undefined = undefined>(
  def: BlockDefinition<F, D>,
): BlockDefinition<F, D> {
  return def
}

export function defineRoot<const F extends Fields, const D extends DataSpecs | undefined = undefined>(
  def: RootDefinition<F, D>,
): RootDefinition<F, D> {
  return def
}

export function defineAdapter<const A extends AdapterDefinition>(def: A): A {
  return def
}

export function defineCategories<const C extends Categories>(c: C): C {
  return c
}

/**
 * Placeholder for a Puck slot. Renders an inert marker that the host swaps for the real
 * slot only when `data-nonce` matches the per-render nonce it generated.
 */
export function Slot({ name }: { name: string }): ReactElement {
  return createElement('div', { 'data-puck-slot': name, 'data-nonce': renderState.nonce ?? '' })
}

// ---------------------------------------------------------------------------
// Query builders: they only build JSON descriptors. Nothing executes here.
// ---------------------------------------------------------------------------

// --- Host data source queries --------------------------------------------------------------
//
// Typing comes from the host's data source type. Either register it once for the whole theme:
//
//   // poc-env.d.ts
//   import type { MockCms } from '@poc/source-mock'
//   declare module '@poc/sdk' { interface Register { source: MockCms } }
//
// and call find('posts', …) with full inference, or pass it explicitly through
// `source<MockCms>().find('posts', …)`. (TypeScript has no partial generic inference, so
// `find<MockCms>('posts')` could not also infer the collection name.)

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Register {}
export type RegisteredSource = Register extends { source: infer S extends AnyDataSource } ? S : AnyDataSource

type Selected<D, Sel> = Sel extends readonly (infer F)[] ? Pick<D, Extract<F, keyof D> | Extract<'id', keyof D>> : D

function hostQueries<S extends AnyDataSource>() {
  return {
    find<K extends CollectionName<S>, const Sel extends readonly (keyof DocOf<S, K> & string)[] | undefined = undefined>(
      collection: K,
      args: FindArgs<DocOf<S, K>, Sel> = {},
    ): QuerySpec<FindResult<Selected<DocOf<S, K>, Sel>>> {
      return { source: 'host', op: 'find', collection, args }
    },
    findByID<K extends CollectionName<S>, const Sel extends readonly (keyof DocOf<S, K> & string)[] | undefined = undefined>(
      collection: K,
      id: string | ParamRef,
      args: { select?: Sel; depth?: number } = {},
    ): QuerySpec<Selected<DocOf<S, K>, Sel> | null> {
      return { source: 'host', op: 'findByID', collection, id, args }
    },
    global<K extends GlobalName<S>>(slug: K): QuerySpec<GlobalDocOf<S, K>> {
      return { source: 'host', op: 'global', slug }
    },
  }
}

/** Query builders typed by an explicit data source type. */
export const source = <S extends AnyDataSource>() => hostQueries<S>()

const registered = hostQueries<RegisteredSource>()
export const find = registered.find
export const findByID = registered.findByID
export const global = registered.global

export function query<T = unknown>(adapter: string, op: string, params: Record<string, ParamValue> = {}): QuerySpec<T> {
  return { source: 'adapter', adapter, op, params }
}

export function http<T = unknown>(spec: {
  origin: string
  path: string
  method?: 'GET' | 'POST'
  params?: Record<string, ParamValue>
  headers?: Record<string, string | SecretRef>
}): QuerySpec<T> {
  return {
    source: 'http',
    origin: spec.origin,
    path: spec.path,
    method: spec.method ?? 'GET',
    params: spec.params ?? {},
    headers: spec.headers ?? {},
  }
}
export type { AnyDataSource, DataSource, CollectionDef, GlobalDef } from './host.ts'
