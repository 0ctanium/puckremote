/** Manifest field specs → Puck fields (editor). */
import type { Field as PuckField, Fields as PuckFields } from '@puckeditor/core'
import type { FieldSpec } from '@puck-remote/core'
import { colorField, linkField, mediaField } from './host-fields.tsx'

type HostFieldType = 'host:color' | 'host:media' | 'host:link'

/** Replacements for the built-in UIs of host:* fields (e.g. a media picker calling your RPC). */
export type HostFieldFactories = Partial<Record<HostFieldType, (spec: Extract<FieldSpec, { type: HostFieldType }>, name: string) => PuckField>>

export function mapField(f: FieldSpec, name: string, host: HostFieldFactories = {}): PuckField {
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
        arrayFields: mapFields(f.arrayFields, host),
        defaultItemProps: f.defaultItemProps,
        min: f.min,
        max: f.max,
        getItemSummary: (item: Record<string, unknown>, i?: number) =>
          summary && item?.[summary] ? String(item[summary]) : `Item ${(i ?? 0) + 1}`,
      }
    }
    case 'object':
      return { type: 'object', label, objectFields: mapFields(f.objectFields, host) }
    case 'slot':
      return { type: 'slot', label, allow: f.allow, disallow: f.disallow }
    case 'host:color':
      return host['host:color']?.(f, name) ?? (colorField(label) as PuckField)
    case 'host:media':
      return host['host:media']?.(f, name) ?? (mediaField(label) as PuckField)
    case 'host:link':
      return host['host:link']?.(f, name) ?? (linkField(label) as PuckField)
  }
}

export function mapFields(fields: Record<string, FieldSpec>, host: HostFieldFactories = {}): PuckFields {
  return Object.fromEntries(Object.entries(fields).map(([n, f]) => [n, mapField(f, n, host)]))
}
