'use client'
/**
 * Publishing workflow in the editor header: save draft, publish, status, conflicts, history and
 * restore. Every write sends the draft revision the editor last saw (optimistic concurrency); a
 * 409 shows the conflict banner instead of overwriting someone else's work.
 */
import { useGetPuck, type Data } from '@puckeditor/core'
import type { PageMeta } from '@puck-remote/sdk/host'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { apiUrl } from '../shared/urls.ts'

type RevisionInfo = { revision: string; createdAt: string; author?: string }
type Api = { get(path: string): Promise<Response>; post(path: string, body?: unknown): Promise<Response> }

const HISTORY_PAGE = 20

/** Editor data minus resolveData output, as a comparable string (what a save would persist). */
export function contentKey(data: unknown): string {
  return JSON.stringify(data, (k, v) => (k === '__data' || k === 'readOnly' ? undefined : v))
}

export function statusOf(meta: PageMeta | null, dirty: boolean): 'Unsaved changes' | 'Draft only' | 'Unpublished changes' | 'Published' {
  if (dirty || !meta) return 'Unsaved changes'
  if (meta.publishedRevision === null) return 'Draft only'
  return meta.publishedRevision === meta.draftRevision ? 'Published' : 'Unpublished changes'
}

export function createApi(apiRoute: string): Api {
  return {
    get: (path) => fetch(apiUrl(apiRoute, path), { credentials: 'same-origin' }),
    // Mutating calls carry the CSRF header (see server/auth.ts) and same-origin credentials.
    post: (path, body) =>
      fetch(apiUrl(apiRoute, path), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-puck-remote': '1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  }
}

/** Shared between Puck's onChange (outside the header) and the header (inside Puck). */
export interface WorkflowState {
  meta: PageMeta | null
  /** contentKey of what is saved; null until the editor reported its loaded data. */
  savedKey: string | null
  currentKey: string | null
}

export function useWorkflowState(initial: PageMeta | null) {
  const [state, setState] = useState<WorkflowState>({ meta: initial, savedKey: null, currentKey: null })
  const dirty = state.savedKey !== null && state.currentKey !== null && state.savedKey !== state.currentKey
  // Leaving with unsaved changes asks first.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])
  return {
    state,
    dirty,
    onChange: (data: Data) => setState((s) => ({ ...s, currentKey: contentKey(data) })),
    setState,
    /** Allow leaving without the prompt (reload after a conflict). */
    forgetChanges: () => (dirtyRef.current = false),
  }
}

const bar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }
const badge: CSSProperties = { fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#334155', whiteSpace: 'nowrap' }
const panel: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  zIndex: 10,
  marginTop: 6,
  width: 340,
  maxHeight: 400,
  overflow: 'auto',
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(15,23,42,.12)',
  padding: 8,
  fontSize: 13,
}
const banner: CSSProperties = {
  position: 'fixed',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: '#fef3c7',
  border: '1px solid #f59e0b',
  borderRadius: 8,
  fontSize: 13,
}

export interface WorkflowHeaderProps {
  slug: string
  api: Api
  workflow: ReturnType<typeof useWorkflowState>
  onStatus(message: string): void
}

export function WorkflowHeader({ slug, api, workflow, onStatus }: WorkflowHeaderProps) {
  const getPuck = useGetPuck()
  const { state, setState, dirty } = workflow
  const [busy, setBusy] = useState(false)
  // undefined: no conflict; otherwise the server's current meta (null: the page no longer exists).
  const [conflict, setConflict] = useState<PageMeta | null | undefined>(undefined)
  const [history, setHistory] = useState<{ items: RevisionInfo[]; more: boolean } | null>(null)

  // Baseline: what the editor loaded counts as saved.
  useEffect(() => {
    const key = contentKey(getPuck().appState.data)
    setState((s) => (s.savedKey === null ? { ...s, savedKey: key, currentKey: s.currentKey ?? key } : s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = () => getPuck().appState.data

  /** Save the current editor data as a new draft. Returns the new meta, or null on failure. */
  async function save(baseRevision: string | null = state.meta?.draftRevision ?? null): Promise<PageMeta | null> {
    const current = data()
    const res = await api.post('pages/save', { slug, data: current, baseRevision })
    const body = await res.json().catch(() => ({}))
    if (res.status === 409) {
      setConflict(body.meta ?? null)
      return null
    }
    if (!res.ok) {
      onStatus(`Save failed (${res.status})`)
      return null
    }
    setConflict(undefined)
    setState((s) => ({ ...s, meta: body.meta, savedKey: contentKey(current) }))
    onStatus(`Saved ${new Date().toLocaleTimeString()}`)
    return body.meta
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const saveDraft = () => run(() => save())

  const publish = () =>
    run(async () => {
      const meta = dirty || !state.meta ? await save() : state.meta
      if (!meta) return
      const res = await api.post('pages/publish', { slug, revision: meta.draftRevision })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) return setConflict(body.meta ?? null)
      if (!res.ok) return onStatus(`Publish failed (${res.status})`)
      setState((s) => ({ ...s, meta: body.meta }))
      onStatus(`Published ${new Date().toLocaleTimeString()}`)
    })

  async function loadHistory(before?: string) {
    const q = new URLSearchParams({ slug, limit: String(HISTORY_PAGE), ...(before ? { before } : {}) })
    const res = await api.get(`pages/history?${q}`)
    if (!res.ok) return onStatus(`History failed (${res.status})`)
    const { revisions } = (await res.json()) as { revisions: RevisionInfo[] }
    setHistory((h) => ({ items: [...(before ? (h?.items ?? []) : []), ...revisions], more: revisions.length === HISTORY_PAGE }))
  }

  const restore = (revision: string) =>
    run(async () => {
      if (dirty && !window.confirm('Discard your unsaved changes and restore this revision?')) return
      const res = await api.post('pages/restore', { slug, revision, baseRevision: state.meta?.draftRevision ?? null })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409) return setConflict(body.meta ?? null)
      if (!res.ok) return onStatus(`Restore failed (${res.status})`)
      // Load the restored draft into the editor.
      const page = await api.get(`pages?slug=${encodeURIComponent(slug)}`)
      if (!page.ok) return onStatus(`Restore failed (${page.status})`)
      const { meta, draft } = (await page.json()) as { meta: PageMeta; draft: { data: Data } }
      getPuck().dispatch({ type: 'setData', data: draft.data })
      const key = contentKey(draft.data)
      setState((s) => ({ ...s, meta, savedKey: key, currentKey: key }))
      setHistory(null)
      onStatus(`Restored revision ${revision}`)
    })

  const status = statusOf(state.meta, dirty)
  const canPublish = !busy && status !== 'Published'

  return (
    <div style={bar}>
      <span style={badge} data-testid="page-status">
        {status}
      </span>
      <button type="button" disabled={busy} onClick={() => (history ? setHistory(null) : void loadHistory())}>
        History
      </button>
      <button type="button" disabled={busy} onClick={saveDraft}>
        Save draft
      </button>
      <button type="button" disabled={!canPublish} onClick={publish}>
        Publish
      </button>
      {history && (
        <div style={panel} data-testid="history-panel">
          {history.items.length === 0 && <div>No revisions yet.</div>}
          {history.items.map((r) => (
            <div key={r.revision} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1 }}>
                <div>{new Date(r.createdAt).toLocaleString()}</div>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {r.author ?? '—'}
                  {r.revision === state.meta?.publishedRevision && ' · published'}
                  {r.revision === state.meta?.draftRevision && ' · draft'}
                </div>
              </div>
              <button type="button" disabled={busy || r.revision === state.meta?.draftRevision} onClick={() => restore(r.revision)}>
                Restore
              </button>
            </div>
          ))}
          {history.more && (
            <button type="button" onClick={() => loadHistory(history.items.at(-1)?.revision)}>
              Load more
            </button>
          )}
        </div>
      )}
      {conflict !== undefined && (
        <div style={banner} role="alert" data-testid="conflict-banner">
          This page was changed elsewhere since you opened it.
          <button
            type="button"
            onClick={() => {
              workflow.forgetChanges()
              location.reload()
            }}
          >
            Reload
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => save(conflict?.draftRevision ?? null))}>
            Overwrite
          </button>
        </div>
      )}
    </div>
  )
}
