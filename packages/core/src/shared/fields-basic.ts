/**
 * Server-safe Puck field mapping: enough for Puck's renderer to find slot fields. The editor
 * uses the full mapping (with host-owned field UIs) in editor/fields.tsx.
 */
import type { Fields as PuckFields } from '@puckeditor/core'
import type { FieldSpec } from '../server/manifest-schema.ts'

export function basicFields(fields: Record<string, FieldSpec>): PuckFields {
  const out: PuckFields = {}
  for (const [name, f] of Object.entries(fields)) {
    out[name] = f.type === 'slot' ? { type: 'slot' } : { type: 'text' }
  }
  return out
}
