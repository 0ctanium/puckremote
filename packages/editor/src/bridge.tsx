/**
 * Editor side: runs inside the iframe on the editor origin, which holds no credentials. Waits
 * for `init` from an allowed parent, loads the theme's browser bundle, rebuilds the Puck config
 * and mounts Puck. Everything that needs authority (data, media, uploads) goes to the host as
 * an RPC; there is no generic fetch or proxy method.
 */
import { Puck, type Data } from '@puckeditor/core'
import type { Manifest } from '@puck-remote/core'
import type { RenderCtx } from '@puck-remote/sdk'
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { buildEditorConfig, type ThemeModule } from './config.tsx'
import { hostToEditorSchema, LIMITS, measure, PROTOCOL_VERSION, type EditorOptions, type EditorPayload, type EditorToHost } from './protocol.ts'

export interface BridgeOptions {
  /** Where to mount the editor. */
  root: HTMLElement
  /** Admin origins allowed to embed this editor (also enforced by CSP frame-ancestors). */
  allowedParents: string[]
  /** Loads the theme module; default: a dynamic import of payload.bundleUrl. */
  loadTheme?: (url: string) => Promise<ThemeModule>
}

/** Why the editor refuses an init, or null. */
export function initProblem(payload: EditorPayload, parentOrigin: string, selfOrigin: string): string | null {
  if (payload.origins.editor !== selfOrigin) return `the editor runs on ${selfOrigin}, not on the configured editor origin ${payload.origins.editor}`
  if (!payload.origins.admin.includes(parentOrigin)) return `${parentOrigin} is not a configured admin origin`
  if (payload.origins.admin.includes(selfOrigin)) return 'the editor must not share an admin origin'
  for (const url of [payload.bundleUrl, payload.assetBase]) {
    if (!payload.origins.admin.includes(new URL(url).origin)) return `theme URL ${url} is not on an admin origin`
  }
  return null
}

function assetUrlFor(assetBase: string) {
  return (path: string) => {
    const clean = String(path).replace(/^\/+/, '')
    if (clean.split('/').some((seg) => seg === '..' || seg === '.') || /[\\?#]|:\/\//.test(clean)) throw new Error(`invalid asset path: ${path}`)
    return assetBase + clean
  }
}

// Stylesheets requested by blocks via ctx.assets.style(), injected into Puck's canvas iframe.
// Updated asynchronously so render functions never set state during render.
const styles = new Set<string>()
const listeners = new Set<() => void>()
let snapshot: string[] = []
function addStyle(url: string, assetBase: string) {
  if (!url.startsWith(assetBase) || styles.has(url)) return
  styles.add(url)
  queueMicrotask(() => {
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

// Publishing lives in the host UI: Puck's own Publish button is removed.
const OVERRIDES = { iframe: CanvasStyles, headerActions: () => <></> }

function Editor(p: { payload: EditorPayload; options: EditorOptions; theme: ThemeModule; rpc: (method: string, params: unknown) => Promise<unknown>; onChange: (data: Data) => void }) {
  const { payload, options, theme, rpc } = p
  const config = useMemo(() => {
    const assetUrl = assetUrlFor(payload.assetBase)
    const ctx: RenderCtx = {
      isEditing: true,
      locale: payload.site.locale,
      nonce: '',
      page: { slug: payload.slug },
      site: { name: payload.site.name },
      assetUrl,
      assets: { script() {}, style: (url) => addStyle(url, payload.assetBase) },
      head: { title() {}, meta() {} },
    }
    return buildEditorConfig(
      payload.manifest as Manifest,
      theme,
      {
        ctx,
        // The page is the host's state: only the block and its props are sent.
        resolve: async (block, props) => ((await rpc('resolveData', { block, props })) as { data: Record<string, unknown> }).data,
      },
      options.categories,
    )
  }, [payload, options, theme, rpc])
  return (
    <Puck
      config={config}
      data={payload.data as unknown as Data}
      onChange={p.onChange}
      headerTitle={`/${payload.slug === 'home' ? '' : payload.slug}`}
      permissions={options.permissions}
      overrides={OVERRIDES}
    />
  )
}

/** Start the bridge: announce `ready` to the allowed parents, then wait for `init`. */
export function startEditorBridge(opts: BridgeOptions): () => void {
  const { root, allowedParents } = opts
  const show = (text: string) => {
    root.textContent = text
  }
  if (window.parent === window) {
    show('This editor only runs embedded in an admin page.')
    return () => {}
  }
  const selfOrigin = window.location.origin
  let parentOrigin: string | null = null
  let nextId = 1
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  const send = (m: EditorToHost) => {
    if (parentOrigin) window.parent.postMessage(m, parentOrigin)
  }

  const rpc = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const size = measure(params)
      if (!size || size.jsonBytes > LIMITS.rpcBytes || size.blobBytes > LIMITS.uploadBytes) return reject(new Error('request too large or not serializable'))
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ v: PROTOCOL_VERSION, type: 'rpc', id, method, params })
    })

  let timer: ReturnType<typeof setTimeout> | null = null
  const onChange = (data: Data) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const size = measure(data)
      if (!size || size.jsonBytes > LIMITS.pageBytes) return send({ v: PROTOCOL_VERSION, type: 'error', message: 'page data too large' })
      send({ v: PROTOCOL_VERSION, type: 'change', data: data as never })
    }, LIMITS.changeDebounceMs)
  }

  async function onMessage(e: MessageEvent) {
    if (e.source !== window.parent || !allowedParents.includes(e.origin)) return
    if (parentOrigin && e.origin !== parentOrigin) return
    const parsed = hostToEditorSchema.safeParse(e.data)
    if (!parsed.success) return
    const m = parsed.data
    if (m.type === 'rpc:result') {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.ok) p?.resolve(m.value)
      else p?.reject(new Error(m.error))
      return
    }
    if (m.type === 'error') return console.error('[editor] host error:', m.message)
    // init: once only, from the parent that will own this session.
    if (parentOrigin) return
    const payload = m.payload as unknown as EditorPayload
    const problem = initProblem(payload, e.origin, selfOrigin)
    if (problem) {
      window.parent.postMessage({ v: PROTOCOL_VERSION, type: 'error', message: problem } satisfies EditorToHost, e.origin)
      return show(`Editor not loaded: ${problem}`)
    }
    parentOrigin = e.origin
    try {
      const theme = await (opts.loadTheme ?? ((url) => import(/* @vite-ignore */ /* webpackIgnore: true */ url).then((mod) => mod.default as ThemeModule)))(payload.bundleUrl)
      createRoot(root).render(<Editor payload={payload} options={m.options as EditorOptions} theme={theme} rpc={rpc} onChange={onChange} />)
    } catch (err) {
      const message = `theme could not be loaded: ${err instanceof Error ? err.message : err}`
      send({ v: PROTOCOL_VERSION, type: 'error', message })
      show(`Editor not loaded: ${message}`)
    }
  }

  window.addEventListener('message', onMessage)
  // Only an allowed parent receives this (postMessage drops mismatched target origins).
  for (const origin of allowedParents) window.parent.postMessage({ v: PROTOCOL_VERSION, type: 'ready' } satisfies EditorToHost, origin)
  return () => window.removeEventListener('message', onMessage)
}
