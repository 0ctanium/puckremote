'use client'
import type { EditorPayload } from '@puck-remote/next'
import { PuckEditorFrame } from '@puck-remote/editor/frame'
import { useMemo, useState } from 'react'

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** Admin UI: the editor frame plus the host's own controls (publish lives here, not in the frame). */
export function AdminEditor({ payload, editorUrl }: { payload: EditorPayload; editorUrl: string }) {
  const [data, setData] = useState<unknown>(null)
  const [artifact, setArtifact] = useState(payload.artifact)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const { slug } = payload
  const rpc = useMemo(
    () => ({
      async resolveData(params: unknown) {
        const r = await post('/api/editor-rpc', { method: 'resolveData', params: { ...(params as object), slug } })
        if (r.status !== 200) throw new Error(`resolveData failed (${r.status})`)
        return r.body.value
      },
    }),
    [slug],
  )

  async function publish() {
    setBusy(true)
    const r = await post('/api/editor-rpc', { method: 'publish', params: { slug, data, base: artifact } })
    setBusy(false)
    const result = r.body.value as { ok: boolean; id?: string; error?: string } | undefined
    if (r.status === 200 && result?.ok && result.id) {
      setArtifact(result.id)
      setData(null)
      setStatus(`Published ${new Date().toLocaleTimeString()}`)
    } else if (result?.error === 'conflict') setStatus('The theme changed since this editor opened: reload the page')
    else setStatus(`Publish failed (${result?.error ?? r.status})`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', font: '14px system-ui, sans-serif' }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <strong>/{slug === 'home' ? '' : slug}</strong>
        <span style={{ color: '#64748b' }} data-testid="artifact-id">
          theme {artifact.slice(0, 12)}
        </span>
        <span style={{ flex: 1, color: '#64748b' }}>{status || (data ? 'Unpublished changes' : '')}</span>
        <button type="button" disabled={!data || busy} onClick={publish}>
          Publish
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PuckEditorFrame
          editorUrl={editorUrl}
          editorOrigin={new URL(editorUrl).origin}
          payload={payload}
          rpc={rpc}
          onChange={setData}
          onError={(m) => setStatus(`Editor: ${m}`)}
        />
      </div>
    </div>
  )
}
