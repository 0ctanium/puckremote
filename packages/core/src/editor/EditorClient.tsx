'use client'
import { Puck, type Data } from '@puckeditor/core'
import '@puckeditor/core/puck.css'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { EditorProps } from '../core.ts'
import { apiUrl, themeAssetBase, themeBundleUrl } from '../shared/urls.ts'
import { loadBundle, newNonce, type BundleApi } from './bundle-frame.ts'
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

export function EditorClient({ manifest, version, slug, site, routes, initialData }: EditorProps) {
  const assetBase = themeAssetBase(routes.theme, version)
  const [bundle, setBundle] = useState<BundleApi | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    loadBundle(version, themeBundleUrl(routes.theme, version)).then(setBundle, (e) => setError(String(e)))
  }, [version, routes.theme])

  const config = useMemo(
    () =>
      buildEditorConfig(manifest, {
        version,
        assetBase,
        slug,
        site,
        render: bundle?.render ?? null,
        newNonce,
        onEffects: (e) => addEffects(e, assetBase),
        resolve: async (blockType, props) => {
          const res = await fetch(apiUrl(routes.api, 'blocks/resolve'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ blockType, props, slug }),
          })
          if (!res.ok) throw new Error(`resolve failed: ${res.status}`)
          return (await res.json()).data
        },
      }),
    [manifest, version, assetBase, slug, site, routes.api, bundle],
  )

  if (error) return <p style={{ padding: 24, color: '#b91c1c' }}>Could not load theme bundle v{version}: {error}</p>
  if (!bundle) return <p style={{ padding: 24, fontFamily: 'system-ui' }}>Loading theme v{version}…</p>

  const save = async (data: Data) => {
    setStatus('Saving…')
    const res = await fetch(apiUrl(routes.api, 'pages'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, data }),
    })
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
                const r = await fetch(apiUrl(routes.api, 'artifact/reload'), { method: 'POST' })
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
