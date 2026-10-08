'use client'
/**
 * Host-owned field UIs (the only "custom" fields that exist). Blocks reference them by name
 * (host:color, host:media, host:link); no developer code runs in the fields panel.
 */
import type { CustomField } from '@puckeditor/core'
import type { CSSProperties } from 'react'

const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const input: CSSProperties = { flex: 1, padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, font: 'inherit', minWidth: 0 }
const label: CSSProperties = { fontSize: 12, color: '#666', display: 'grid', gap: 4 }

function Label({ text }: { text?: string }) {
  return text ? <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{text}</div> : null
}

export const colorField = (fieldLabel?: string): CustomField<string | undefined> => ({
  type: 'custom',
  label: fieldLabel,
  render: ({ value, onChange, readOnly, name }) => (
    <div>
      <Label text={fieldLabel ?? name} />
      <div style={row}>
        <input type="color" aria-label={`${name} picker`} value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#000000'} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
        <input style={input} aria-label={name} value={value ?? ''} placeholder="#rrggbb" disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  ),
})

type Media = { url: string; alt?: string }
export const mediaField = (fieldLabel?: string): CustomField<Media | undefined> => ({
  type: 'custom',
  label: fieldLabel,
  render: ({ value, onChange, readOnly, name }) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <Label text={fieldLabel ?? name} />
      <label style={label}>
        Image URL
        <input style={input} value={value?.url ?? ''} disabled={readOnly} placeholder="https://…" onChange={(e) => onChange({ ...value, url: e.target.value })} />
      </label>
      <label style={label}>
        Alt text
        <input style={input} value={value?.alt ?? ''} disabled={readOnly} onChange={(e) => onChange({ url: value?.url ?? '', alt: e.target.value })} />
      </label>
      {value?.url && /^https:\/\//.test(value.url) && <img src={value.url} alt="" style={{ maxWidth: '100%', borderRadius: 4 }} />}
    </div>
  ),
})

type Link = { href: string; label?: string; newTab?: boolean }
export const linkField = (fieldLabel?: string): CustomField<Link | undefined> => ({
  type: 'custom',
  label: fieldLabel,
  render: ({ value, onChange, readOnly, name }) => (
    <div style={{ display: 'grid', gap: 6 }}>
      <Label text={fieldLabel ?? name} />
      <label style={label}>
        URL
        <input style={input} value={value?.href ?? ''} disabled={readOnly} placeholder="/page or https://…" onChange={(e) => onChange({ ...value, href: e.target.value })} />
      </label>
      <label style={label}>
        Label
        <input style={input} value={value?.label ?? ''} disabled={readOnly} onChange={(e) => onChange({ href: value?.href ?? '', ...value, label: e.target.value })} />
      </label>
      <label style={{ ...row, fontSize: 12 }}>
        <input type="checkbox" checked={!!value?.newTab} disabled={readOnly} onChange={(e) => onChange({ href: value?.href ?? '', ...value, newTab: e.target.checked })} />
        Open in new tab
      </label>
    </div>
  ),
})
