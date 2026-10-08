'use client'
import { Puck } from '@puckeditor/core'
// The variant without external imports: the editor's CSP allows no third-party origins.
import '@puckeditor/core/no-external.css'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { EditorProps } from '../core.ts'
import { themeAssetBase } from '../shared/urls.ts'
import { createRemoteRenderer } from './remote-render.ts'
import { buildEditorConfig, type EditorEffect } from './config.tsx'
import { createApi, useWorkflowState, WorkflowHeader } from './workflow.tsx'

// Stylesheets requested by blocks via ctx.assets.style(), injected into Puck's canvas iframe.
// Updated asynchronously so render functions never set state during render.
const styles = new Set<string>()
const listeners = new Set<() => void>()
let snapshot: string[] = []
function addEffects(effects: EditorEffect[], base: string) {
  let changed = false
  for (const e of effects) {
    if (e.kind === 'style' && e.url?.startsWith(base) && !styles.has(e.url)) {
      styles.add(e.url)
      changed = true
    }
  }
  if (changed) queueMicrotask(() => {
    snapshot = [...styles]
    listeners.forEach((l) => l())
  })
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function CanvasStyles({ document: doc, children }: { document?: Document; children: ReactNode }) {
  const urls = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
  useEffect(() => {
    if (!doc) return
    for (const url of urls) {
      if (doc.head.querySelector(`link[data-theme-style="${CSS.escape(url)}"]`)) continue
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = url
      link.dataset.themeStyle = url
      doc.head.appendChild(link)
    }
  }, [doc, urls])
  return <>{children}</>
}

export type { EditorProps }

export function EditorClient({ manifest, version, slug, site, routes, siteOrigin, initialData, page, previewEnabled, migrationErrors }: EditorProps) {
  const assetBase = themeAssetBase(routes.theme, version)
  const [status, setStatus] = useState<string>(migrationErrors.length ? `Migration failed: ${migrationErrors.join(', ')}` : '')
  // Blocks are rendered by the server (one batched call per tick); theme JS never runs here.
  const renderer = useMemo(() => createRemoteRenderer({ apiRoute: routes.api, slug }), [routes.api, slug, version])
  const api = useMemo(() => createApi(routes.api), [routes.api])
  const workflow = useWorkflowState(page)

  const config = useMemo(
    () =>
      buildEditorConfig(manifest, {
        version,
        slug,
        site,
        renderer,
        onEffects: (e) => addEffects(e, assetBase),
        resolve: async (blockType, props) => {
          const res = await api.post('blocks/resolve', { blockType, props, slug })
          if (!res.ok) throw new Error(`resolve failed: ${res.status}`)
          return (await res.json()).data
        },
      }),
    [manifest, version, assetBase, slug, site, api, renderer],
  )

  const header = { slug, version, siteOrigin, api, workflow, status, setStatus, previewEnabled }
  return (
    <HeaderContext.Provider value={header}>
      <Puck config={config} data={initialData} onChange={workflow.onChange} headerTitle={`/${slug === 'home' ? '' : slug}`} overrides={OVERRIDES} />
    </HeaderContext.Provider>
  )
}

/**
 * Header state comes through context: Puck remounts an override whose identity changes, so the
 * overrides object must stay stable (otherwise every edit would reset the header's state).
 */
const HeaderContext = createContext<{
  slug: string
  version: number
  siteOrigin: string
  api: ReturnType<typeof createApi>
  workflow: ReturnType<typeof useWorkflowState>
  status: string
  setStatus(s: string): void
  previewEnabled: boolean
} | null>(null)

// Puck's own Publish button (children) is replaced by the workflow controls.
function HeaderActions() {
  const { slug, version, siteOrigin, api, workflow, status, setStatus, previewEnabled } = useContext(HeaderContext)!
  return (
    <>
      <span style={{ fontSize: 12, color: '#64748b' }} data-testid="artifact-version">
        theme v{version} · {status}
      </span>
      <button
        type="button"
        onClick={async () => {
          const r = await api.post('artifact/reload')
          const j = await r.json()
          setStatus(j.ok ? `artifact v${j.version}` : `reload failed: ${j.error}`)
          if (j.ok && j.version !== version) location.reload()
        }}
      >
        Reload theme
      </button>
      <a href={`${siteOrigin}/${slug === 'home' ? '' : slug}`} target="_blank" rel="noreferrer">
        View page
      </a>
      <WorkflowHeader slug={slug} api={api} workflow={workflow} onStatus={setStatus} previewEnabled={previewEnabled} />
    </>
  )
}

const OVERRIDES = { iframe: CanvasStyles, headerActions: HeaderActions }
