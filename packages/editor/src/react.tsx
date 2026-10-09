'use client'
/**
 * Editor side, as a React component the app renders in its own page on the editor origin (which
 * holds no credentials). It waits for `init` from an allowed parent, loads the theme's browser
 * bundle, rebuilds the Puck config and renders Puck. Everything that needs authority (data,
 * media, uploads) goes to the host as an RPC; there is no generic fetch or proxy method.
 *
 *   <PuckRemoteEditor allowedParents={['https://admin.example.com']} overrides={…} plugins={…} />
 *   // anywhere inside: const { rpc, payload } = useEditor()
 */
import { Puck, type Config, type Data, type Overrides, type Plugin, type Viewports } from '@puckeditor/core'
import type { Manifest } from '@puck-remote/core'
import type { RenderCtx } from '@puck-remote/sdk'
import { registerSharedModules } from '@puck-remote/sdk/browser'
import * as React from 'react'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { buildEditorConfig, type ThemeModule } from './config.tsx'
import type { HostFieldFactories } from './fields.ts'
import { hostToEditorSchema, LIMITS, measure, PROTOCOL_VERSION, type EditorOptions, type EditorPayload, type EditorToHost } from './protocol.ts'

/** Why the editor refuses an init, or null. */
export function initProblem(payload: EditorPayload, parentOrigin: string, selfOrigin: string): string | null {
  if (payload.origins.editor !== selfOrigin) return `the editor runs on ${selfOrigin}, not on the configured editor origin ${payload.origins.editor}`
  if (!payload.origins.host.includes(parentOrigin)) return `${parentOrigin} is not a configured host origin`
  if (payload.origins.host.includes(selfOrigin)) return 'the editor must not share a host origin'
  for (const url of [payload.bundleUrl, payload.assetBase]) {
    if (!payload.origins.host.includes(new URL(url).origin)) return `theme URL ${url} is not on a host origin`
  }
  return null
}

export type Rpc = (method: string, params?: unknown) => Promise<unknown>

export interface HostConnection {
  rpc: Rpc
  /** Debounced: the full page data. */
  change(data: Data): void
  error(message: string): void
  close(): void
}

/**
 * The editor's side of the protocol, without React: announce `ready` to the allowed parents,
 * accept one `init` from `window.parent` on an allowed origin, then exchange RPCs and changes.
 */
export function connectToHost(opts: {
  allowedParents: string[]
  onInit: (payload: EditorPayload, options: EditorOptions) => void
  onProblem: (message: string) => void
  win?: Window
}): HostConnection {
  const win = opts.win ?? window
  let parentOrigin: string | null = null
  let nextId = 1
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  const send = (m: EditorToHost) => {
    if (parentOrigin) win.parent.postMessage(m, parentOrigin)
  }

  function onMessage(e: MessageEvent) {
    if (e.source !== win.parent || !opts.allowedParents.includes(e.origin)) return
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
    if (m.type === 'error') return opts.onProblem(`host: ${m.message}`)
    // init: once only, from the parent that will own this session.
    if (parentOrigin) return
    const payload = m.payload as unknown as EditorPayload
    const problem = initProblem(payload, e.origin, win.location.origin)
    if (problem) {
      win.parent.postMessage({ v: PROTOCOL_VERSION, type: 'error', message: problem } satisfies EditorToHost, e.origin)
      return opts.onProblem(problem)
    }
    parentOrigin = e.origin
    opts.onInit(payload, m.options as EditorOptions)
  }

  win.addEventListener('message', onMessage)
  if (win.parent === win) opts.onProblem('this editor only runs embedded in an admin page')
  // Only an allowed parent receives this (postMessage drops mismatched target origins).
  else for (const origin of opts.allowedParents) win.parent.postMessage({ v: PROTOCOL_VERSION, type: 'ready' } satisfies EditorToHost, origin)

  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    rpc: (method, params) =>
      new Promise((resolve, reject) => {
        if (!parentOrigin) return reject(new Error('not connected'))
        const size = measure(params ?? null)
        if (!size || size.jsonBytes > LIMITS.rpcBytes || size.blobBytes > LIMITS.uploadBytes) return reject(new Error('request too large or not serializable'))
        const id = nextId++
        pending.set(id, { resolve, reject })
        send({ v: PROTOCOL_VERSION, type: 'rpc', id, method, params: params ?? null })
      }),
    change(data) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const size = measure(data)
        if (!size || size.jsonBytes > LIMITS.pageBytes) return send({ v: PROTOCOL_VERSION, type: 'error', message: 'page data too large' })
        send({ v: PROTOCOL_VERSION, type: 'change', data: data as never })
      }, LIMITS.changeDebounceMs)
    },
    error: (message) => send({ v: PROTOCOL_VERSION, type: 'error', message: message.slice(0, 2000) }),
    close() {
      win.removeEventListener('message', onMessage)
      if (timer) clearTimeout(timer)
      for (const p of pending.values()) p.reject(new Error('closed'))
      pending.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

export interface EditorContextValue {
  /** Call a method the admin page allow-listed in <PuckEditorFrame rpc={…}>. */
  rpc: Rpc
  payload: EditorPayload
  options: EditorOptions
}

const EditorContext = createContext<EditorContextValue | null>(null)

/** The editor's connection to the host, inside <PuckRemoteEditor> (overrides, plugins, custom fields). */
export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor() must be used inside <PuckRemoteEditor>')
  return ctx
}

type PuckProps = ComponentProps<typeof Puck>

export interface PuckRemoteEditorProps {
  /** Admin origins allowed to embed this editor (also enforce them with CSP frame-ancestors). */
  allowedParents: string[]
  /** Merged over the editor's own overrides (theme styles in the canvas, empty header actions). */
  overrides?: Partial<Overrides>
  plugins?: Plugin[]
  ui?: PuckProps['ui']
  viewports?: Viewports
  iframe?: PuckProps['iframe']
  /** Replacements for the built-in host:* field UIs. */
  fields?: HostFieldFactories
  /** Last chance to change the Puck config built from the manifest and the theme. */
  transformConfig?: (config: Config) => Config
  /** Shown until the host sends `init` and the theme is loaded. */
  fallback?: ReactNode
  onError?: (message: string) => void
}

/** Same URLs as the public site: assetBase + path + `?v=` (first 12 hex chars of the file's sha256). */
function assetUrlFor(assetBase: string, files: Record<string, string>) {
  return (path: string) => {
    const clean = String(path).replace(/^\/+/, '')
    if (clean.split('/').some((seg) => seg === '..' || seg === '.') || /[\\?#]|:\/\//.test(clean)) throw new Error(`invalid asset path: ${path}`)
    const sha = Object.hasOwn(files, `assets/${clean}`) ? files[`assets/${clean}`] : null
    return assetBase + clean + (sha ? `?v=${sha.slice(0, 12)}` : '')
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
const NoActions = () => <></>

type State = { status: 'waiting' } | { status: 'error'; message: string } | { status: 'ready'; payload: EditorPayload; options: EditorOptions; theme: ThemeModule }

const loadTheme = (url: string): Promise<ThemeModule> => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url).then((m) => m.default as ThemeModule)

export function PuckRemoteEditor(props: PuckRemoteEditorProps) {
  const [state, setState] = useState<State>({ status: 'waiting' })
  const [connection, setConnection] = useState<HostConnection | null>(null)
  const parentsKey = props.allowedParents.join(',')
  const onError = props.onError

  useEffect(() => {
    registerSharedModules()
    let live = true
    const fail = (message: string) => {
      if (!live) return
      setState({ status: 'error', message })
      onError?.(message)
    }
    const conn = connectToHost({
      allowedParents: props.allowedParents,
      onProblem: fail,
      onInit: (payload, options) => {
        loadTheme(payload.bundleUrl).then(
          (theme) => live && setState({ status: 'ready', payload, options, theme }),
          (err) => {
            const message = `theme could not be loaded: ${err instanceof Error ? err.message : err}`
            conn.error(message)
            fail(message)
          },
        )
      },
    })
    setConnection(conn)
    return () => {
      live = false
      conn.close()
    }
    // allowedParents compared by value.
  }, [parentsKey])

  if (state.status === 'error') return <div role="alert" style={{ padding: 16, font: '14px system-ui, sans-serif', color: '#b91c1c' }}>Editor not loaded: {state.message}</div>
  if (state.status === 'waiting' || !connection) return <>{props.fallback ?? null}</>
  return <ReadyEditor {...props} payload={state.payload} options={state.options} theme={state.theme} connection={connection} />
}

function ReadyEditor(p: PuckRemoteEditorProps & { payload: EditorPayload; options: EditorOptions; theme: ThemeModule; connection: HostConnection }) {
  const { payload, options, theme, connection, transformConfig, fields } = p
  const config = useMemo(() => {
    const ctx: RenderCtx = {
      isEditing: true,
      locale: payload.site.locale,
      nonce: '',
      page: { slug: payload.slug },
      site: { name: payload.site.name },
      assetUrl: assetUrlFor(payload.assetBase, (payload.manifest as Manifest).files ?? {}),
      assets: { script() {}, style: (url) => addStyle(url, payload.assetBase) },
      head: { title() {}, meta() {} },
    }
    const built = buildEditorConfig(
      payload.manifest as Manifest,
      theme,
      {
        ctx,
        hostFields: fields,
        // The page is the host's state: only the block and its props are sent.
        resolve: async (block, props) => ((await connection.rpc('resolveData', { block, props })) as { data: Record<string, unknown> }).data,
      },
      options.categories,
    )
    return transformConfig ? transformConfig(built) : built
  }, [payload, options, theme, connection, transformConfig, fields])
  // Puck remounts an override whose identity changes: keep the merged object stable.
  const overrides = useMemo(() => ({ iframe: CanvasStyles, headerActions: NoActions, ...p.overrides }), [p.overrides])
  const value = useMemo(() => ({ rpc: connection.rpc, payload, options }), [connection, payload, options])
  return (
    <EditorContext.Provider value={value}>
      <Puck
        config={config}
        data={payload.data as unknown as Data}
        onChange={connection.change}
        headerTitle={`/${payload.slug === 'home' ? '' : payload.slug}`}
        permissions={options.permissions}
        overrides={overrides}
        plugins={p.plugins}
        ui={p.ui}
        viewports={p.viewports}
        iframe={p.iframe}
      />
    </EditorContext.Provider>
  )
}

export { buildEditorConfig, type ThemeModule } from './config.tsx'
export { colorField, linkField, mediaField } from './host-fields.tsx'
export type { HostFieldFactories } from './fields.ts'
