/**
 * TypedRpc (D-0317): `useEditor<typeof rpc>().rpc` is typed by the admin page's handler map.
 * Type-level only; checked by vitest's expectTypeOf and by `tsc` (the @ts-expect-error lines).
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { RpcHandlers, TypedRpc } from '../src/protocol.ts'

const handlers = {
  currentUser: async () => 'admin',
  resolveData: async (p: { slug: string; block: string }) => ({ data: { title: p.block }, usesRequestParams: false }),
  search: (p?: { q: string }) => [p?.q ?? ''],
} satisfies RpcHandlers
type Admin = typeof handlers

// No-op stubs: only the types matter here.
const stub = () => Promise.resolve(undefined as never)
const rpc = stub as unknown as TypedRpc<Admin>
const loose = stub as unknown as TypedRpc

describe('TypedRpc', () => {
  it('method names are the map keys', () => {
    expectTypeOf<Parameters<typeof rpc>[0]>().toEqualTypeOf<'currentUser' | 'resolveData' | 'search'>()
  })

  it('infers params and results', () => {
    expectTypeOf(rpc('currentUser')).toEqualTypeOf<Promise<string>>()
    expectTypeOf(rpc('resolveData', { slug: 'home', block: 'hero' })).toEqualTypeOf<
      Promise<{ data: { title: string }; usesRequestParams: boolean }>
    >()
    // Optional params may be left out; sync handlers still resolve through the protocol.
    expectTypeOf(rpc('search')).toEqualTypeOf<Promise<string[]>>()
  })

  it('rejects unknown methods and wrong params', () => {
    if (Math.random() < 2) return // type-level checks only: never call
    // @ts-expect-error unknown method
    void rpc('nope')
    // @ts-expect-error missing required params
    void rpc('resolveData')
    // @ts-expect-error wrong params
    void rpc('resolveData', { slug: 1 })
    // @ts-expect-error no params expected
    void rpc('currentUser', { x: 1 })
  })

  it('stays loose without a map', () => {
    expectTypeOf(loose('anything')).toEqualTypeOf<Promise<any>>()
    expectTypeOf(loose('anything', { x: 1 })).toEqualTypeOf<Promise<any>>()
  })
})
