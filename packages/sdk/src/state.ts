// Per-render state set by the isolate runtime. Module-level is fine: render is synchronous.
export const renderState: { nonce: string | null } = { nonce: null }
