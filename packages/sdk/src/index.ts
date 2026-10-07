import { createElement, type ReactElement } from 'react'
import { renderState } from './state.ts'
import type {
  AdapterDefinition,
  BlockDefinition,
  Categories,
  DataSpecs,
  Doc,
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

export function find<T = Doc>(collection: string, args: FindArgs = {}): QuerySpec<FindResult<T>> {
  return { source: 'payload', op: 'find', collection, args }
}

export function findByID<T = Doc>(collection: string, id: string | ParamRef): QuerySpec<T | null> {
  return { source: 'payload', op: 'findByID', collection, id }
}

export function global<T = Doc>(slug: string): QuerySpec<T> {
  return { source: 'payload', op: 'global', slug }
}

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
