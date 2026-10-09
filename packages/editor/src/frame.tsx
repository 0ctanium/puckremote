"use client";
/**
 * Host side: the admin page's Puck. It holds the page data, the history and the fields panel, and
 * its config comes from the manifest alone (placeholder renders), so no theme code runs on the
 * admin origin. The canvas, the drawer and the outline run in the editor iframe (another origin,
 * credential-free), which proposes Puck actions; they are validated and replayed here, and this
 * side's state is sent back. All authority stays here: publishing, history and RPC handlers.
 *
 *   <PuckEditorFrame payload={payload} editorUrl={url} resolveData={…}>
 *     <MyHeader />  <PuckEditorFrame.Canvas />  <Puck.Fields />
 *   </PuckEditorFrame>
 */
import { createUsePuck, Puck, useGetPuck, type Data, type Overrides, type Plugin } from "@puckeditor/core";
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
  /** Passed to this side's Puck (fields, drawer items are the editor's). */
  overrides?: Partial<Overrides>;
  plugins?: Plugin[];
  /** Your layout: place <PuckEditorFrame.Canvas /> and Puck's own components (<Puck.Fields />…). */
  children?: ReactNode;
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

/** For your admin UI inside <PuckEditorFrame>. History and data: Puck's own createUsePuck(). */
export function usePuckEditorFrame(): {
  payload: EditorPayload;
  /** True once the editor answered and received `init`. */
  frameReady: boolean;
  setLeftSideBarVisible: (visible: boolean) => void;
} {
  const ctx = useFrameContext("usePuckEditorFrame()");
  return {
    payload: ctx.props.current!.payload,
    frameReady: ctx.frameReady,
    setLeftSideBarVisible: (visible) =>
      ctx.post({ v: PROTOCOL_VERSION, type: "ui", leftSideBarVisible: visible }),
  };
}

const usePuck = createUsePuck();

/** Inside this side's Puck: replays the editor's actions and sends the resulting state back. */
function EditorBridge() {
  const ctx = useFrameContext("EditorBridge");
  const getPuck = useGetPuck();
  const data = usePuck((s) => s.appState.data);
  const itemSelector = usePuck((s) => s.appState.ui.itemSelector) as ItemSelector;
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

function DefaultLayout() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", height: "100%" }}>
      <Canvas />
      <aside style={{ overflow: "auto", borderLeft: "1px solid #e2e8f0" }}>
        <Puck.Fields />
      </aside>
    </div>
  );
}

export function PuckEditorFrame(props: PuckEditorFrameProps) {
  const { payload, options = {}, fields } = props;
  const latest = useRef(props);
  latest.current = props;
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const editorOrigin = props.editorOrigin ?? safeOrigin(props.editorUrl);
  const manifest = payload.manifest as Manifest;

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
      editorOrigin,
      iframe,
      frameReady,
      setFrameReady,
      post: (m) => iframe.current?.contentWindow?.postMessage(m, editorOrigin),
    }),
    [editorOrigin, frameReady],
  );

  return (
    <FrameContext.Provider value={value}>
      <Puck
        key={`${payload.artifact}:${payload.slug}`}
        config={config}
        data={payload.data as unknown as Data}
        onChange={(data) => latest.current.onChange?.(data as unknown as PageData)}
        permissions={options.permissions}
        overrides={props.overrides}
        plugins={props.plugins}
      >
        <EditorBridge />
        {props.children ?? <DefaultLayout />}
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
