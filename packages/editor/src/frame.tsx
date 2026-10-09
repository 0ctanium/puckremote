"use client";
/**
 * Host side: the admin page's Puck. It holds the page data, the history and the fields panel, and
 * its config comes from the manifest alone (placeholder renders), so no theme code runs on the
 * admin origin. The canvas, the drawer and the outline run in the editor iframe (another origin,
 * credential-free), which proposes Puck actions; they are validated and replayed here, and this
 * side's state is sent back. All authority stays here: publishing, history and RPC handlers.
 *
 * By default it renders Puck's native layout (header, plugin rail, fields) with the editor frame
 * in the center. Plugins marked with framePlugin() render their panel in the frame (the drawer,
 * whose drag and drop goes into the canvas); the others render here.
 *
 *   <PuckEditorFrame payload={payload} editorUrl={url} resolveData={…} onPublish={…} />
 */
import { blocksPlugin, createUsePuck, outlinePlugin, Puck, useGetPuck, type Data, type Overrides, type Plugin } from "@puckeditor/core";
import type { Manifest } from "@puck-remote/core";
import type { RenderCtx } from "@puck-remote/sdk";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { buildEditorConfig, MISSING_TYPE, placeholderTheme } from "./config.tsx";
import type { HostFieldFactories } from "./fields.ts";
import {
  editorToHostSchema,
  LIMITS,
  measure,
  PROTOCOL_VERSION,
  rateLimiter,
  type EditorOptions,
  type EditorPayload,
  type FrameAction,
  type HostToEditor,
  type ItemSelector,
  type PageData,
  type RpcHandlers,
} from "./protocol.ts";

export { stripResolved } from "./config.tsx";
export { colorField, linkField, mediaField } from "./host-fields.tsx";
export type { HostFieldFactories } from "./fields.ts";
export type { FrameAction, ItemSelector, RpcHandler, RpcHandlers, TypedRpc } from "./protocol.ts";

export interface PuckEditorFrameProps {
  /** URL of the editor page (served on the editor origin). */
  editorUrl: string;
  /** Origin of the editor page; defaults to editorUrl's. Must match payload.origins.editor. */
  editorOrigin?: string;
  /** From core.editorPayload(): page, manifest, theme URLs, origins. */
  payload: EditorPayload;
  /** JSON-only options (permissions, locales, categories, flags), applied on both sides. */
  options?: EditorOptions;
  /** Methods the editor may call (allow-list). They run with this page's session; theme code can call them. */
  rpc?: RpcHandlers;
  /** Data for one block, e.g. a server action calling core.resolveBlockData. Needed when blocks declare data. */
  resolveData?: (block: string, props: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Replacements for the built-in host:* field UIs. */
  fields?: HostFieldFactories;
  /** Every change of the page data (this side's Puck). */
  onChange?: (data: PageData) => void;
  onError?: (message: string) => void;
  /** Passed to this side's Puck (e.g. headerActions, fields). `preview` is always the frame. */
  overrides?: Partial<Overrides>;
  /**
   * Puck plugins in this side's rail. framePlugin(name) marks one whose panel renders in the
   * frame. Default: [framePlugin('blocks'), outlinePlugin()] (the outline renders here).
   */
  plugins?: Plugin[];
  /** Puck's native Publish button. */
  onPublish?: (data: PageData) => void;
  /** Header title (default: the page path) and path. */
  headerTitle?: string;
  headerPath?: string;
  /** Your own layout instead of Puck's native one: place <PuckEditorFrame.Canvas /> and Puck's components. */
  children?: ReactNode;
}

const framePlugins = new WeakSet<Plugin>();

/**
 * A plugin whose icon sits in this side's rail but whose panel renders in the editor frame
 * (<PuckRemoteEditor plugins> provides it under the same name). Use it for panels that drag into
 * the canvas, like the blocks drawer.
 */
export function framePlugin(name: string, opts: { label?: string; icon?: ReactNode } = {}): Plugin {
  // On small screens Puck shows panels as a bottom sheet: this one is empty, so it takes no height
  // and the frame keeps the space (the frame shows the real panel itself).
  const plugin: Plugin = { name, label: opts.label, icon: opts.icon, render: () => <></>, mobilePanelHeight: "min-content" };
  framePlugins.add(plugin);
  return plugin;
}

const defaultBlocks = blocksPlugin();
// Listed explicitly so the rail keeps Puck's order (Blocks, then Outline).
const DEFAULT_PLUGINS = [framePlugin("blocks", { label: defaultBlocks.label, icon: defaultBlocks.icon }), outlinePlugin()];

/**
 * Where the left panel goes, from this side's Puck UI state. A frame plugin is active: this side's
 * panel collapses and the frame shows that plugin's panel. Otherwise the panel is here and the
 * frame shows none.
 */
export function frameUi(
  current: string | null | undefined,
  framePluginNames: readonly string[],
  leftSideBarVisible: boolean,
  leftSideBarWidth: number | null = null,
): { collapseHere: boolean; frame: { leftSideBarVisible: boolean; plugin: string | null; leftSideBarWidth: number | null } } {
  // One panel width for both sides (null: Puck's default).
  if (current && framePluginNames.includes(current)) return { collapseHere: true, frame: { leftSideBarVisible, plugin: current, leftSideBarWidth } };
  return { collapseHere: false, frame: { leftSideBarVisible: false, plugin: null, leftSideBarWidth } };
}

/** Why the frame refuses to load, or null. */
export function frameProblem(
  p: { editorUrl: string; editorOrigin: string; payload: EditorPayload },
  hostOrigin: string,
): string | null {
  let urlOrigin: string;
  try {
    urlOrigin = new URL(p.editorUrl).origin;
  } catch {
    return "editorUrl is not a valid URL";
  }
  if (urlOrigin !== p.editorOrigin)
    return `editorUrl is not on editorOrigin (${p.editorOrigin})`;
  if (p.editorOrigin !== p.payload.origins.editor)
    return `editorOrigin does not match the configured editor origin (${p.payload.origins.editor})`;
  if (!p.payload.origins.host.includes(hostOrigin))
    return `this page (${hostOrigin}) is not on a configured admin origin`;
  if (p.editorOrigin === hostOrigin)
    return "the editor must not share the admin origin";
  return null;
}

/** Puck permission each proposed action needs. */
const PERMISSION: Record<FrameAction["type"], keyof NonNullable<EditorOptions["permissions"]> | null> = {
  insert: "insert",
  duplicate: "duplicate",
  remove: "delete",
  move: "drag",
  reorder: "drag",
  replace: "edit",
  replaceRoot: "edit",
  setUi: null,
};

export interface HostHandlerOptions {
  editorOrigin: string;
  /** The iframe's window: messages from anything else are ignored. */
  source: () => unknown;
  post: (m: HostToEditor) => void;
  init: () => { payload: EditorPayload; options: EditorOptions };
  rpc: () => RpcHandlers;
  /** Block types the theme has (inserts of anything else are refused). */
  blocks: () => readonly string[];
  /** A validated action to replay, or null when it was refused (resync the editor). */
  onAction: (seq: number, action: FrameAction | null) => void;
  onIntent: (intent: "undo" | "redo") => void;
  /** The editor's panel was resized (display only). */
  onUi?: (leftSideBarWidth: number | null) => void;
  /** Sent after `init`: the editor needs this side's current state. */
  onReady: () => void;
  onError: (message: string) => void;
  now?: () => number;
}

/** This side's message handling, without React or the DOM. */
export function hostMessageHandler(o: HostHandlerOptions) {
  const allow = rateLimiter(LIMITS.rpcPerSecond, o.now);
  const post = o.post;
  const fail = o.onError;
  return async function onMessage(e: {
    origin: string;
    source: unknown;
    data: unknown;
  }) {
    // Both checks: the right origin AND our own iframe's window (not another frame on that origin).
    const source = o.source();
    if (e.origin !== o.editorOrigin || !source || e.source !== source) return;
    const size = measure(e.data);
    if (
      !size ||
      size.jsonBytes > LIMITS.pageBytes + LIMITS.rpcBytes ||
      size.blobBytes > LIMITS.uploadBytes
    )
      return fail("message too large or not serializable");
    const parsed = editorToHostSchema.safeParse(e.data);
    if (!parsed.success) {
      // A refused action still has to be acknowledged, or the editor would wait for it forever.
      const seq = (e.data as { type?: unknown; seq?: unknown } | null)?.seq;
      if ((e.data as { type?: unknown } | null)?.type === "action" && Number.isInteger(seq) && (seq as number) > 0) o.onAction(seq as number, null);
      return fail(
        `invalid message from the editor${(e.data as { v?: unknown } | null)?.v !== PROTOCOL_VERSION ? " (protocol version mismatch)" : ""}`,
      );
    }
    const m = parsed.data;
    switch (m.type) {
      case "ready":
        post({ v: PROTOCOL_VERSION, type: "init", ...o.init() });
        o.onReady();
        return;
      case "action": {
        const action = m.action as FrameAction;
        const refuse = (why: string) => {
          o.onAction(m.seq, null);
          fail(why);
        };
        if (size.jsonBytes > LIMITS.rpcBytes) return refuse("action too large");
        if (action.type === "insert" && action.componentType !== MISSING_TYPE && !o.blocks().includes(action.componentType))
          return refuse(`unknown block ${action.componentType}`);
        const permission = PERMISSION[action.type];
        if (permission && o.init().options.permissions?.[permission] === false)
          return refuse(`${action.type} is not permitted`);
        return o.onAction(m.seq, action);
      }
      case "intent":
        return o.onIntent(m.intent);
      case "ui":
        return o.onUi?.(m.leftSideBarWidth);
      case "error":
        return fail(m.message);
      case "rpc": {
        const reply = (
          r: { ok: true; value: unknown } | { ok: false; error: string },
        ) => post({ v: PROTOCOL_VERSION, type: "rpc:result", id: m.id, ...r });
        if (!allow()) return reply({ ok: false, error: "rate limited" });
        if (size.jsonBytes > LIMITS.rpcBytes)
          return reply({ ok: false, error: "request too large" });
        const handlers = o.rpc();
        if (!Object.hasOwn(handlers, m.method))
          return reply({ ok: false, error: `unknown method ${m.method}` });
        try {
          const value = await handlers[m.method](m.params);
          const out = measure(value);
          if (!out || out.blobBytes || out.jsonBytes > LIMITS.rpcBytes)
            return reply({ ok: false, error: "result too large or not JSON" });
          reply({ ok: true, value });
        } catch (err) {
          reply({
            ok: false,
            error: err instanceof Error ? err.message.slice(0, 500) : "failed",
          });
        }
        return;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

interface FrameContextValue {
  props: RefObject<PuckEditorFrameProps>;
  framePluginNames: readonly string[];
  editorOrigin: string;
  iframe: RefObject<HTMLIFrameElement | null>;
  frameReady: boolean;
  setFrameReady: (ready: boolean) => void;
  post: (m: HostToEditor) => void;
}

const FrameContext = createContext<FrameContextValue | null>(null);

function useFrameContext(name: string): FrameContextValue {
  const ctx = useContext(FrameContext);
  if (!ctx) throw new Error(`${name} must be used inside <PuckEditorFrame>`);
  return ctx;
}

/** For your admin UI inside <PuckEditorFrame>. History, data and UI: Puck's own createUsePuck(). */
export function usePuckEditorFrame(): {
  payload: EditorPayload;
  /** True once the editor answered and received `init`. */
  frameReady: boolean;
} {
  const ctx = useFrameContext("usePuckEditorFrame()");
  return { payload: ctx.props.current!.payload, frameReady: ctx.frameReady };
}

const usePuck = createUsePuck();

// Puck ignores a width of 0; 1px collapses this side's panel while a frame plugin is active.
const COLLAPSED = 1;

/**
 * Puck 0.23 adds a top padding back on wide screens (>= 1198px): its rule for a canvas without
 * controls is more specific than its own full-screen rule. This keeps the frame edge to edge. It
 * relies on Puck's class-name prefix (`PuckCanvas--fullScreen`): update it if Puck renames that class.
 */
const FULL_SCREEN_CANVAS = '[class*="PuckCanvas--fullScreen"]{padding:0!important}';

function useFullScreenCanvas() {
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.puckRemote = "full-screen-canvas";
    style.textContent = FULL_SCREEN_CANVAS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

/** Inside this side's Puck: replays the editor's actions and sends the resulting state back. */
function EditorBridge() {
  const ctx = useFrameContext("EditorBridge");
  useFullScreenCanvas();
  const getPuck = useGetPuck();
  const data = usePuck((s) => s.appState.data);
  const itemSelector = usePuck((s) => s.appState.ui.itemSelector) as ItemSelector;
  const currentPlugin = usePuck((s) => s.appState.ui.plugin?.current ?? null);
  const leftSideBarVisible = usePuck((s) => s.appState.ui.leftSideBarVisible);
  const leftSideBarWidth = usePuck((s) => s.appState.ui.leftSideBarWidth ?? null);
  // The shared panel width while this side's panel is collapsed for a frame plugin.
  const savedWidth = useRef<number | null>(null);
  const ack = useRef(0);
  const lastSent = useRef<string | null>(null);
  const [resync, setResync] = useState(0);
  const { frameReady, post, setFrameReady } = ctx;

  useEffect(() => {
    const onMessage = hostMessageHandler({
      editorOrigin: ctx.editorOrigin,
      source: () => ctx.iframe.current?.contentWindow ?? null,
      post,
      init: () => ({ payload: ctx.props.current!.payload, options: ctx.props.current!.options ?? {} }),
      rpc: () => ctx.props.current!.rpc ?? {},
      blocks: () => Object.keys((ctx.props.current!.payload.manifest as Manifest).blocks),
      onAction: (seq, action) => {
        ack.current = seq;
        if (action) getPuck().dispatch(action as never);
        // Answer every action, even when nothing changed here (refused, or already equal).
        setResync((n) => n + 1);
      },
      onIntent: (intent) => (intent === "undo" ? getPuck().history.back() : getPuck().history.forward()),
      // Resized in the frame: keep it for when this side's panel opens again.
      onUi: (width) => {
        savedWidth.current = width;
      },
      onReady: () => {
        lastSent.current = null;
        setFrameReady(true);
        setResync((n) => n + 1);
      },
      onError: (message) => ctx.props.current!.onError?.(message),
    });
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ctx, getPuck, post, setFrameReady]);

  // The left panel: here for this side's plugins, in the frame for frame plugins.
  const names = ctx.framePluginNames;
  useEffect(() => {
    const dispatch = getPuck().dispatch;
    const sharedWidth = leftSideBarWidth === COLLAPSED ? savedWidth.current : leftSideBarWidth;
    const ui = frameUi(currentPlugin, names, leftSideBarVisible, sharedWidth);
    if (ui.collapseHere && leftSideBarWidth !== COLLAPSED) {
      savedWidth.current = leftSideBarWidth;
      dispatch({ type: "setUi", ui: { leftSideBarWidth: COLLAPSED }, recordHistory: false });
    } else if (!ui.collapseHere && leftSideBarWidth === COLLAPSED) {
      dispatch({ type: "setUi", ui: { leftSideBarWidth: savedWidth.current }, recordHistory: false });
    }
    if (frameReady) post({ v: PROTOCOL_VERSION, type: "ui", ...ui.frame });
  }, [currentPlugin, leftSideBarVisible, leftSideBarWidth, names, frameReady, post, getPuck]);

  useEffect(() => {
    if (!frameReady) return;
    const size = measure(data);
    if (!size || size.jsonBytes > LIMITS.pageBytes) {
      // Same bound as before the split: a page that grows past it is rolled back.
      getPuck().history.back();
      ctx.props.current!.onError?.("page data too large");
      return;
    }
    const json = JSON.stringify({ data, itemSelector, ack: ack.current });
    if (json === lastSent.current) return;
    lastSent.current = json;
    post({ v: PROTOCOL_VERSION, type: "state", data: data as unknown as PageData, itemSelector: itemSelector ?? null, ack: ack.current });
  }, [data, itemSelector, frameReady, resync, post, getPuck, ctx]);
  return null;
}

/** The editor iframe (canvas, drawer, outline), wherever you place it in your layout. */
function Canvas({ title = "Page editor", className, style }: { title?: string; className?: string; style?: CSSProperties }) {
  const ctx = useFrameContext("<PuckEditorFrame.Canvas>");
  const p = ctx.props.current!;
  // undefined until the origin checks ran (in the browser): the iframe is never created before.
  const [problem, setProblem] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setProblem(frameProblem({ editorUrl: p.editorUrl, editorOrigin: ctx.editorOrigin, payload: p.payload }, window.location.origin));
  }, [p.editorUrl, ctx.editorOrigin, p.payload]);
  if (problem === undefined) return null;
  if (problem)
    return (
      <div role="alert" style={{ padding: 16, color: "#b91c1c", font: "14px system-ui, sans-serif" }}>
        Editor not loaded: {problem}
      </div>
    );
  return (
    <iframe
      key={`${p.payload.artifact}:${p.payload.slug}`}
      ref={ctx.iframe}
      src={p.editorUrl}
      title={title}
      className={className}
      style={{ border: 0, width: "100%", height: "100%", display: "block", ...style }}
      // No top navigation, no plugins; same-origin is the editor's own origin (Puck's canvas needs it).
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      referrerPolicy="no-referrer"
      onLoad={() => ctx.setFrameReady(false)}
    />
  );
}

/** Puck's center area (native layout) holds the editor frame instead of a canvas. */
const FramePreview = () => <Canvas style={{ minHeight: "100%" }} />;

export function PuckEditorFrame(props: PuckEditorFrameProps) {
  const { payload, options = {}, fields } = props;
  const latest = useRef(props);
  latest.current = props;
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const editorOrigin = props.editorOrigin ?? safeOrigin(props.editorUrl);
  const manifest = payload.manifest as Manifest;
  const plugins = props.plugins ?? DEFAULT_PLUGINS;
  const framePluginNames = useMemo(() => plugins.filter((p) => framePlugins.has(p) && p.name).map((p) => p.name!), [plugins]);
  // Stable identity: Puck remounts overrides that change.
  const overrides = useMemo(() => {
    const AppPuck = props.overrides?.puck;
    return {
      ...props.overrides,
      preview: FramePreview,
      // Wraps both the native layout and custom children: the bridge lives inside Puck either way.
      puck: ({ children }: { children: ReactNode }) => (
        <>
          <EditorBridge />
          {AppPuck ? <AppPuck>{children}</AppPuck> : children}
        </>
      ),
    };
  }, [props.overrides]);

  const config = useMemo(() => {
    // Placeholder renders: this side shows fields, never a canvas.
    const ctx: RenderCtx = {
      isEditing: true,
      locale: payload.site.locale,
      nonce: "",
      page: { slug: payload.slug },
      site: { name: payload.site.name },
      assetUrl: (p) => p,
      assets: { script() {}, style() {} },
      head: { title() {}, meta() {} },
    };
    return buildEditorConfig(
      manifest,
      placeholderTheme(manifest),
      {
        ctx,
        hostFields: fields,
        resolve: async (block, blockProps) => {
          const resolve = latest.current.resolveData;
          if (!resolve) throw new Error(`no resolveData for block ${block}`);
          return resolve(block, blockProps);
        },
      },
      options.categories,
    );
    // The latest resolveData is read at call time.
  }, [manifest, payload.site, payload.slug, fields, options.categories]);

  const value = useMemo<FrameContextValue>(
    () => ({
      props: latest,
      framePluginNames,
      editorOrigin,
      iframe,
      frameReady,
      setFrameReady,
      post: (m) => iframe.current?.contentWindow?.postMessage(m, editorOrigin),
    }),
    [editorOrigin, frameReady, framePluginNames],
  );

  return (
    <FrameContext.Provider value={value}>
      <Puck
        key={`${payload.artifact}:${payload.slug}`}
        config={config}
        data={payload.data as unknown as Data}
        onChange={(data) => latest.current.onChange?.(data as unknown as PageData)}
        onPublish={(data) => latest.current.onPublish?.(data as unknown as PageData)}
        headerTitle={props.headerTitle ?? `/${payload.slug === "home" ? "" : payload.slug}`}
        headerPath={props.headerPath}
        permissions={options.permissions}
        overrides={overrides}
        plugins={plugins}
        // No canvas here: the center area holds the editor frame (its own viewport and zoom controls).
        iframe={{ enabled: false }}
        // Edge to edge: the frame's canvas has its own padding.
        _experimentalFullScreenCanvas
      >
        {props.children}
      </Puck>
    </FrameContext.Provider>
  );
}

PuckEditorFrame.Canvas = Canvas;

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
