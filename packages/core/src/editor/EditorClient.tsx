'use client'
import { Puck, type Data } from '@puckeditor/core'
import '@puckeditor/core/puck.css'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { EditorProps } from '../core.ts'
import { apiUrl, themeAssetBase } from '../shared/urls.ts'
import { createRemoteRenderer } from './remote-render.ts'
import { buildEditorConfig, type EditorEffect } from './config.tsx'

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

/** Mutating calls carry the CSRF header (see server/auth.ts) and same-origin credentials. */
function apiPost(apiRoute: string, path: string, body?: unknown) {
  return fetch(apiUrl(apiRoute, path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-puck-remote': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function EditorClient({ manifest, version, slug, site, routes, initialData }: EditorProps) {
  const assetBase = themeAssetBase(routes.theme, version)
  const [status, setStatus] = useState<string>('')
  // Blocks are rendered by the server (one batched call per tick); theme JS never runs here.
  const renderer = useMemo(() => createRemoteRenderer({ apiRoute: routes.api, slug }), [routes.api, slug, version])

  const config = useMemo(
    () =>
      buildEditorConfig(manifest, {
        version,
        slug,
        site,
        renderer,
        onEffects: (e) => addEffects(e, assetBase),
        resolve: async (blockType, props) => {
          const res = await apiPost(routes.api, 'blocks/resolve', { blockType, props, slug })
          if (!res.ok) throw new Error(`resolve failed: ${res.status}`)
          return (await res.json()).data
        },
      }),
    [manifest, version, assetBase, slug, site, routes.api, renderer],
  )

  const save = async (data: Data) => {
    setStatus('Saving…')
    const res = await apiPost(routes.api, 'pages', { slug, data })
    setStatus(res.ok ? `Saved ${new Date().toLocaleTimeString()}` : `Save failed (${res.status})`)
  }

  return (
    <Puck
      config={config}
      data={initialData}
      onPublish={save}
      headerTitle={`/${slug === 'home' ? '' : slug}`}
      overrides={{
        iframe: CanvasStyles,
        headerActions: ({ children }) => (
          <>
            <span style={{ fontSize: 12, color: '#64748b' }} data-testid="artifact-version">
              theme v{version} · {status}
            </span>
            <button
              type="button"
              onClick={async () => {
                const r = await apiPost(routes.api, 'artifact/reload')
                const j = await r.json()
                setStatus(j.ok ? `artifact v${j.version}` : `reload failed: ${j.error}`)
                if (j.ok && j.version !== version) location.reload()
              }}
            >
              Reload theme
            </button>
            <a href={`/${slug === 'home' ? '' : slug}`} target="_blank" rel="noreferrer">
              View page
            </a>
            {children}
          </>
        ),
      }}
    />
  )
}
