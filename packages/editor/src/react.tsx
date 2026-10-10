'use client'
/**
 * Editor side, as a React component the app renders in its own page on the editor origin (which
 * holds no credentials). It waits for `init` from an allowed parent, loads the theme's browser
 * bundle, rebuilds the Puck config and renders the canvas, the drawer and the outline. The host's
 * Puck (<PuckEditorFrame>) holds the data, the history and the fields: this side proposes Puck
 * actions and applies the host's state. There is no generic fetch or proxy method.
 *
 *   <PuckRemoteEditor allowedParents={['https://admin.example.com']} overrides={…} plugins={…} />
 *   // anywhere inside: const { rpc, payload } = useEditor()
 */
import { blocksPlugin, createUsePuck, Puck, useGetPuck, type Config, type Data, type Overrides, type Plugin, type PuckAction, type Viewports } from '@puckeditor/core'
import type { Manifest } from '@puck-remote/core'
import type { RenderCtx } from '@puck-remote/sdk'
import { registerSharedModules } from '@puck-remote/sdk/browser'
import * as React from 'react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { buildEditorConfig, withoutResolveData, type ThemeModule } from './config.tsx'
import { hostToEditorSchema, LIMITS, measure, PROTOCOL_VERSION, type EditorOptions, type EditorPayload, type EditorToHost, type FrameAction, type HostToEditor, type ItemSelector, type RpcHandlers, type TypedRpc } from './protocol.ts'

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

type StateMessage = Extract<HostToEditor, { type: 'state' }>
type HostUi = { leftSideBarVisible: boolean; plugin: string | null; leftSideBarWidth: number | null }

export interface HostConnection {
  rpc: Rpc
  /** Propose a Puck action to the host (it validates and replays it). */
  action(seq: number, action: FrameAction): void
  intent(intent: 'undo' | 'redo'): void
  /** The host's state. The latest one is kept until a listener subscribes. */
  onState(listener: (m: StateMessage) => void): () => void
  onUi(listener: (ui: HostUi) => void): () => void
  /** Report a resize of this side's panel (the width is shared with the host's panel). */
  panelWidth(width: number | null): void
  error(message: string): void
  close(): void
}

/**
 * The editor's side of the protocol, without React: announce `ready` to the allowed parents,
 * accept one `init` from `window.parent` on an allowed origin, then exchange actions, states and RPCs.
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
  const stateListeners = new Set<(m: StateMessage) => void>()
  const uiListeners = new Set<(ui: HostUi) => void>()
  let lastUi: HostUi | null = null
  let lastState: StateMessage | null = null
  const send = (m: EditorToHost) => {
    if (parentOrigin) win.parent.postMessage(m, parentOrigin)
  }

  function onMessage(e: MessageEvent) {
    if (e.source !== win.parent || !opts.allowedParents.includes(e.origin)) return
    if (parentOrigin && e.origin !== parentOrigin) return
    const parsed = hostToEditorSchema.safeParse(e.data)
    if (!parsed.success) return
    const m = parsed.data
    if (m.type === 'init') {
      // Once only, from the parent that will own this session.
      if (parentOrigin) return
      const payload = m.payload as unknown as EditorPayload
      const problem = initProblem(payload, e.origin, win.location.origin)
      if (problem) {
        win.parent.postMessage({ v: PROTOCOL_VERSION, type: 'error', message: problem } satisfies EditorToHost, e.origin)
        return opts.onProblem(problem)
      }
      parentOrigin = e.origin
      return opts.onInit(payload, m.options as EditorOptions)
    }
    if (!parentOrigin) return
    switch (m.type) {
      case 'rpc:result': {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (m.ok) p?.resolve(m.value)
        else p?.reject(new Error(m.error))
        return
      }
      case 'state':
        lastState = m as StateMessage
        for (const l of stateListeners) l(lastState)
        return
      case 'ui':
        lastUi = { leftSideBarVisible: m.leftSideBarVisible, plugin: m.plugin, leftSideBarWidth: m.leftSideBarWidth }
        for (const l of uiListeners) l(lastUi)
        return
      case 'error':
        return opts.onProblem(`host: ${m.message}`)
    }
  }

  win.addEventListener('message', onMessage)
  if (win.parent === win) opts.onProblem('this editor only runs embedded in an admin page')
  // Only an allowed parent receives this (postMessage drops mismatched target origins).
  else for (const origin of opts.allowedParents) win.parent.postMessage({ v: PROTOCOL_VERSION, type: 'ready' } satisfies EditorToHost, origin)

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
    action: (seq, action) => send({ v: PROTOCOL_VERSION, type: 'action', seq, action }),
    intent: (intent) => send({ v: PROTOCOL_VERSION, type: 'intent', intent }),
    panelWidth: (width) => send({ v: PROTOCOL_VERSION, type: 'ui', leftSideBarWidth: width }),
    onState(listener) {
      stateListeners.add(listener)
      if (lastState) listener(lastState)
      return () => stateListeners.delete(listener)
    },
    onUi(listener) {
      uiListeners.add(listener)
      if (lastUi) listener(lastUi)
      return () => uiListeners.delete(listener)
    },
    error: (message) => send({ v: PROTOCOL_VERSION, type: 'error', message: message.slice(0, 2000) }),
    close() {
      win.removeEventListener('message', onMessage)
      stateListeners.clear()
      uiListeners.clear()
      for (const p of pending.values()) p.reject(new Error('closed'))
      pending.clear()
    },
  }
}

const pick = <T extends object, K extends keyof T>(o: T, keys: K[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as Pick<T, K>

/**
 * The part of a Puck action the host may replay, or null if it stays local (hover, drag state,
 * panels) or came from the host itself (dispatched with `recordHistory: false`).
 */
export function toFrameAction(action: PuckAction): FrameAction | null {
  if (action.recordHistory === false) return null
  switch (action.type) {
    case 'insert':
      return { type: 'insert', ...pick(action, ['componentType', 'destinationIndex', 'destinationZone', 'id']) }
    case 'duplicate':
      return { type: 'duplicate', ...pick(action, ['sourceIndex', 'sourceZone']) }
    case 'reorder':
      return { type: 'reorder', ...pick(action, ['sourceIndex', 'destinationIndex', 'destinationZone']) }
    case 'move':
      return { type: 'move', ...pick(action, ['sourceIndex', 'sourceZone', 'destinationIndex', 'destinationZone']) }
    case 'remove':
      return { type: 'remove', ...pick(action, ['index', 'zone']) }
    case 'replace':
      return { type: 'replace', ...pick(action, ['destinationIndex', 'destinationZone']), data: action.data as unknown as { type: string; props: Record<string, unknown> } }
    case 'replaceRoot':
      return { type: 'replaceRoot', root: action.root as { props?: Record<string, unknown> } }
    case 'setUi':
      return typeof action.ui === 'object' && 'itemSelector' in action.ui ? { type: 'setUi', ui: { itemSelector: (action.ui.itemSelector ?? null) as ItemSelector } } : null
    default:
      return null
  }
}

/**
 * Ordering rule (B7): local actions are numbered; a host state is applied only once the host has
 * acknowledged every one of them, so in-flight edits are never overwritten by an older state.
 */
export function createFrameSync() {
  let seq = 0
  return {
    local(action: PuckAction): { seq: number; action: FrameAction } | null {
      const a = toFrameAction(action)
      if (!a) return null
      seq += 1
      return { seq, action: a }
    },
    accepts: (ack: number) => ack >= seq,
  }
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

export interface EditorContextValue<T extends RpcHandlers = RpcHandlers> {
  /**
   * Call a method the admin page allow-listed in <PuckEditorFrame rpc={…}>. Typed by the admin
   * page's map: `useEditor<typeof rpc>()` (a type-only import).
   */
  rpc: TypedRpc<T>
  payload: EditorPayload
  options: EditorOptions
}

const EditorContext = createContext<EditorContextValue | null>(null)

/**
 * The editor's connection to the host, inside <PuckRemoteEditor> (overrides, plugins, custom fields).
 * `T` is the type of the admin page's `rpc` map; the caller asserts it (types don't cross origins).
 */
export function useEditor<T extends RpcHandlers = RpcHandlers>(): EditorContextValue<T> {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor() must be used inside <PuckRemoteEditor>')
  return ctx as unknown as EditorContextValue<T>
}

type PuckProps = ComponentProps<typeof Puck>

export interface PuckRemoteEditorProps {
  /** Admin origins allowed to embed this editor (also enforce them with CSP frame-ancestors). */
  allowedParents: string[]
  /**
   * Merged over the editor's own overrides (theme styles in the canvas, no header). The fields
   * panel is the host's: it lives in <PuckEditorFrame>, so field overrides belong there.
   */
  overrides?: Partial<Overrides>
  /**
   * Plugins whose panel renders here, selected from the admin page's rail (framePlugin there,
   * same name). Default: [blocksPlugin()], the drawer you drag from into the canvas.
   */
  plugins?: Plugin[]
  /** Puck UI state; the right (fields) panel always stays hidden. */
  ui?: PuckProps['ui']
  viewports?: Viewports
  iframe?: PuckProps['iframe']
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

// The header (title, undo/redo, Publish) is the host's: Puck's own is removed.
const NoHeader = () => <></>

const usePuck = createUsePuck()

/**
 * Puck shows its plugin nav (a rail on desktop, a tab bar under 638px) from its own layout, with no
 * option to turn it off; the nav is the host's. This rule hides it in the editor frame only. It
 * relies on Puck's class-name prefix (`PuckLayout-nav`): update it if Puck renames that class.
 */
const HIDE_PUCK_NAV = '[class*="PuckLayout-nav"]{display:none!important}'

function useHidePuckNav() {
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.puckRemote = 'hide-nav'
    style.textContent = HIDE_PUCK_NAV
    document.head.appendChild(style)
    return () => style.remove()
  }, [])
}

const DEFAULT_FRAME_PLUGINS = [blocksPlugin()]

/** The frame plugin whose panel shows, as chosen in the admin page's rail. */
function createPanelStore() {
  let current: string | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(name: string | null) {
      if (name === current) return
      current = name
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}
type PanelStore = ReturnType<typeof createPanelStore>

/**
 * The left panel's single plugin. Named like Puck's legacy sidebar plugin so that Puck hides its
 * plugin rail (the rail is the admin page's); it renders the frame plugin the admin selected.
 */
function panelPlugin(store: PanelStore, plugins: Plugin[]): Plugin {
  function Panel() {
    const name = useSyncExternalStore(store.subscribe, store.get, store.get)
    const plugin = plugins.find((p) => p.name === name)
    const Render = plugin?.render
    return Render ? <Render /> : <></>
  }
  return { name: 'legacy-side-bar', render: Panel }
}

/** Inside Puck: applies the host's state and UI, and forwards undo/redo shortcuts to the host. */
function HostBridge({ connection, sync, panel }: { connection: HostConnection; sync: ReturnType<typeof createFrameSync>; panel: PanelStore }) {
  const getPuck = useGetPuck()
  // The panel width is shared with the host's panel: report your resizes, not the host's echoes.
  const width = usePuck((s) => s.appState.ui.leftSideBarWidth ?? null)
  const hostWidth = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    if (hostWidth.current === undefined || width === hostWidth.current) return
    hostWidth.current = width
    connection.panelWidth(width)
  }, [width, connection])
  useEffect(() => {
    const offState = connection.onState((m) => {
      // The host hasn't seen all our actions yet: its state is older than ours.
      if (!sync.accepts(m.ack)) return
      const { appState, dispatch } = getPuck()
      if (JSON.stringify(appState.data) !== JSON.stringify(m.data)) dispatch({ type: 'setData', data: m.data as unknown as Data, recordHistory: false })
      if (JSON.stringify(appState.ui.itemSelector ?? null) !== JSON.stringify(m.itemSelector)) dispatch({ type: 'setUi', ui: { itemSelector: m.itemSelector }, recordHistory: false })
    })
    const offUi = connection.onUi((ui) => {
      panel.set(ui.plugin)
      hostWidth.current = ui.leftSideBarWidth
      getPuck().dispatch({ type: 'setUi', ui: { leftSideBarVisible: ui.leftSideBarVisible && ui.plugin !== null, leftSideBarWidth: ui.leftSideBarWidth }, recordHistory: false })
    })
    return () => {
      offState()
      offUi()
    }
  }, [connection, sync, panel, getPuck])

  // Undo/redo belong to the host's history: forward the shortcut instead of running Puck's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      e.stopImmediatePropagation()
      connection.intent(e.shiftKey ? 'redo' : 'undo')
    }
    const docs = new Set<Document>([document])
    document.addEventListener('keydown', onKey, true)
    // Puck's canvas is an iframe of its own; attach once it exists.
    const timer = setInterval(() => {
      for (const frame of document.querySelectorAll('iframe')) {
        const doc = frame.contentDocument
        if (doc && !docs.has(doc)) {
          docs.add(doc)
          doc.addEventListener('keydown', onKey, true)
        }
      }
    }, 500)
    return () => {
      clearInterval(timer)
      for (const d of docs) d.removeEventListener('keydown', onKey, true)
    }
  }, [connection])
  return null
}

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
  const { payload, options, theme, connection, transformConfig } = p
  const config = useMemo(() => {
    const ctx: RenderCtx = {
      isEditing: true,
      locale: payload.site.locale,
      nonce: '',
      template: { name: payload.template },
      params: payload.params,
      site: { name: payload.site.name },
      assetUrl: assetUrlFor(payload.assetBase, (payload.manifest as Manifest).files ?? {}),
      assets: { script() {}, style: (url) => addStyle(url, payload.assetBase) },
    }
    // The host resolves data and sends `__data` with its state.
    const built = withoutResolveData(buildEditorConfig(payload.manifest as Manifest, theme, { ctx, resolve: async () => ({}) }, options.categories, payload.root))
    return transformConfig ? transformConfig(built) : built
  }, [payload, options, theme, transformConfig])
  const sync = useMemo(() => createFrameSync(), [connection])
  const panel = useMemo(() => createPanelStore(), [connection])
  const appPlugins = p.plugins ?? DEFAULT_FRAME_PLUGINS
  // The panel plugin first (Puck sorts it first anyway); the app's plugins keep their overrides.
  const plugins = useMemo(() => [panelPlugin(panel, appPlugins), ...appPlugins], [panel, appPlugins])
  const onAction = useMemo(
    () => (action: PuckAction) => {
      const m = sync.local(action)
      if (m) connection.action(m.seq, m.action)
    },
    [sync, connection],
  )
  // Puck remounts an override whose identity changes: keep the merged object stable.
  const overrides = useMemo(() => {
    const AppPuck = p.overrides?.puck
    return {
      iframe: CanvasStyles,
      header: NoHeader,
      ...p.overrides,
      puck: ({ children }: { children: ReactNode }) => (
        <>
          <HostBridge connection={connection} sync={sync} panel={panel} />
          {AppPuck ? <AppPuck>{children}</AppPuck> : children}
        </>
      ),
    }
  }, [p.overrides, connection, sync, panel])
  // Hidden until the admin page says which panel to show.
  const ui = useMemo(() => ({ leftSideBarVisible: false, ...p.ui, rightSideBarVisible: false }), [p.ui])
  useHidePuckNav()
  const value = useMemo(() => ({ rpc: connection.rpc, payload, options }), [connection, payload, options])
  return (
    <EditorContext.Provider value={value}>
      <Puck
        config={config}
        data={payload.data as unknown as Data}
        onAction={onAction}
        permissions={options.permissions}
        overrides={overrides}
        plugins={plugins}
        ui={ui}
        viewports={p.viewports}
        iframe={p.iframe}
      />
    </EditorContext.Provider>
  )
}

export { buildEditorConfig, type ThemeModule } from './config.tsx'
export type { FrameAction, ItemSelector, RpcHandler, RpcHandlers, TypedRpc } from './protocol.ts'
