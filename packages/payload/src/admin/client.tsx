/**
 * `@puck-remote/payload/admin/client` — the client side of the plugin's views: the editor around
 * <PuckEditorFrame> (like examples/app's ClientEditor) and the theme actions. They call the
 * plugin's endpoints under Payload's API with the admin session.
 */
import '@puckeditor/core/puck.css'
import { createUsePuck } from '@puckeditor/core'
import type { EditorPayload } from '@puck-remote/core'
import { PuckEditorFrame, stripResolved } from '@puck-remote/editor/frame'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type EditedTheme = { id: string; name: string; role: string }

/** POST to a plugin endpoint (same origin: Payload's session cookie authenticates it). */
async function call<T>(api: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${api}/puck-remote/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok && !('ok' in (json as object))) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json
}

const usePuck = createUsePuck()

/** What would be saved, as JSON (resolved data stripped): the "unsaved changes" baseline. */
const saved = (data: unknown) => JSON.stringify(stripResolved(data as Parameters<typeof stripResolved>[0]))

type PublishState = { theme: EditedTheme; status: string; baseline: { current: string | null }; user: string; themesUrl: string; previewUrl: string | null }
const PublishContext = createContext<PublishState | null>(null)

/** Next to Puck's own Publish button: the status, the theme, the user, a preview link and the way back. */
function HeaderActions({ children }: { children: ReactNode }) {
  const state = useContext(PublishContext)!
  const data = usePuck((s) => s.appState.data)
  // The first state Puck holds (after its own normalization) is the published one.
  state.baseline.current ??= saved(data)
  const dirty = saved(data) !== state.baseline.current
  // Leaving the page (the template switcher included) with unpublished changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  return (
    <>
      <span style={{ color: '#64748b', font: '13px system-ui, sans-serif' }} data-testid="status">
        {dirty ? 'Unpublished changes' : state.status} · {state.theme.name}
        {state.theme.role === 'main' ? '' : ` (${state.theme.role})`} · {state.user}
      </span>
      {state.previewUrl && (
        <a href={state.previewUrl} target="_blank" rel="noreferrer">
          Preview
        </a>
      )}
      {children}
      <a href={state.themesUrl}>Themes</a>
    </>
  )
}

// Stable identity: Puck remounts overrides that change.
const OVERRIDES = { headerActions: HeaderActions }

/** The editor: Puck's layout on this admin page, the theme's components in the frame (editor origin). */
export function EditorClient(props: {
  payload: EditorPayload
  editorUrl: string
  api: string
  themesUrl: string
  previewUrl: string | null
  /** This view's URL, for the template switcher's links. */
  editorUrlBase: string
  /** The ?theme= this view was opened with (kept when switching templates). */
  themeParam: string | null
  /** The site path of each template (the plugin's previewPath, run on the server). */
  templatePaths: Record<string, string>
  user: string
  theme: EditedTheme
}) {
  const { payload, editorUrl, api, theme, user } = props
  const { template } = payload
  const [hash, setHash] = useState(payload.hash)
  const [status, setStatus] = useState('')
  const baseline = useRef<string | null>(null)

  async function handlePublish(data: unknown) {
    try {
      const result = await call<{ ok: boolean; hash?: string; error?: string }>(api, 'publish', { template, data, base: hash, theme: theme.id })
      if (result.ok) {
        setHash(result.hash!)
        baseline.current = saved(data)
        setStatus(`Published ${new Date().toLocaleTimeString()}`)
      } else if (result.error === 'conflict') {
        setStatus('The theme changed since this editor opened: reload the page')
      } else {
        setStatus(`Publish failed (${result.error ?? 'Unknown error'})`)
      }
    } catch (e) {
      setStatus(`Publish failed (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  return (
    <PublishContext.Provider value={{ theme, status, baseline, user, themesUrl: props.themesUrl, previewUrl: props.previewUrl }}>
      <div style={{ height: '100vh' }}>
        <PuckEditorFrame
          payload={payload}
          editorUrl={editorUrl}
          // What the frame (theme code) may call: harmless methods only.
          rpc={{ currentUser: () => user }}
          resolveData={async (block, blockProps, t) =>
            (await call<{ data: Record<string, unknown> }>(api, 'resolve-data', { template: t.name, params: t.params, theme: theme.id, block, props: blockProps })).data
          }
          onPublish={handlePublish}
          onError={(m) => setStatus(`Editor: ${m}`)}
          overrides={OVERRIDES}
          templateHref={(name) => {
            const search = new URLSearchParams({ previewPath: props.templatePaths[name] ?? `/${name}` })
            if (props.themeParam) search.set('theme', props.themeParam)
            return `${props.editorUrlBase}?${search}`
          }}
        />
      </div>
    </PublishContext.Provider>
  )
}

/** Publish, duplicate, rename and delete buttons for one theme of the themes view. */
export function ThemeActions({ api, theme }: { api: string; theme: EditedTheme }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(op: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    setError(null)
    try {
      const r = await call<{ ok?: boolean; error?: string }>(api, `themes/${op}`, { theme: theme.id, ...extra })
      if (r.ok) location.reload()
      else setError(r.error ?? 'failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const rename = () => {
    const name = prompt('Theme name', theme.name)?.trim()
    if (name && name !== theme.name) void run('rename', { name })
  }
  const remove = () => {
    if (confirm(`Delete the theme "${theme.name}" and its files?`)) void run('delete')
  }
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {error && <span style={{ color: 'var(--theme-error-500)' }}>{error}</span>}
      {theme.role !== 'main' && (
        <button type="button" disabled={busy} onClick={() => run('publish')}>
          Publish
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => run('duplicate')}>
        Duplicate
      </button>
      <button type="button" disabled={busy} onClick={rename}>
        Rename
      </button>
      {theme.role !== 'main' && (
        <button type="button" disabled={busy} onClick={remove}>
          Delete
        </button>
      )}
    </span>
  )
}
