'use client'
import { useState } from 'react'

/** An island ("use client"). */
export function Widget({ label }: { label: unknown }) {
  const [n, setN] = useState(0)
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      {String(label)} {n}
    </button>
  )
}
