import type { ComponentType, ReactElement } from 'react'

// Per-render state set by the isolate runtime. Module-level is fine: render is synchronous.
export const renderState: {
  nonce: string | null
  /** Set by the isolate runtime: records an island and returns its marker. */
  island: ((id: string, component: ComponentType<any>, props: Record<string, unknown>) => ReactElement) | null
} = { nonce: null, island: null }
