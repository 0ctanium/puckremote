/** Manifest field specs → Puck fields (editor). */
import type { Field as PuckField, Fields as PuckFields } from '@puckeditor/core'
import type { FieldSpec } from '../server/manifest-schema.ts'
import { colorField, linkField, mediaField } from './host-fields.tsx'

export function mapField(f: FieldSpec, name: string): PuckField {
  const label = f.label ?? name
  switch (f.type) {
    case 'text':
    case 'textarea':
      return { type: f.type, label, placeholder: f.placeholder } as PuckField
    case 'number':
      return { type: 'number', label, min: f.min, max: f.max, step: f.step }
    case 'select':
    case 'radio':
      return { type: f.type, label, options: f.options }
    case 'array': {
      const summary = f.itemSummary
      return {
        type: 'array',
        label,
        arrayFields: mapFields(f.arrayFields),
        defaultItemProps: f.defaultItemProps,
        min: f.min,
        max: f.max,
        getItemSummary: (item: Record<string, unknown>, i?: number) =>
          summary && item?.[summary] ? String(item[summary]) : `Item ${(i ?? 0) + 1}`,
      }
    }
    case 'object':
      return { type: 'object', label, objectFields: mapFields(f.objectFields) }
    case 'slot':
      return { type: 'slot', label, allow: f.allow, disallow: f.disallow }
    case 'host:color':
      return colorField(label) as PuckField
    case 'host:media':
      return mediaField(label) as PuckField
    case 'host:link':
      return linkField(label) as PuckField
  }
}

export function mapFields(fields: Record<string, FieldSpec>): PuckFields {
  return Object.fromEntries(Object.entries(fields).map(([n, f]) => [n, mapField(f, n)]))
}
