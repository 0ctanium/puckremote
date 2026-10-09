"use client";
/**
 * Host side: embeds the editor app (another origin, credential-free) in an iframe and talks to
 * it only through the typed protocol. All authority stays here: RPC calls run allow-listed
 * handlers with the host's own session, and publishing lives in the host UI, outside the frame.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  editorToHostSchema,
  LIMITS,
  measure,
  PROTOCOL_VERSION,
  rateLimiter,
  type EditorOptions,
  type EditorPayload,
  type HostToEditor,
  type PageData,
  type RpcHandlers,
} from "./protocol.ts";

export type { RpcHandler, RpcHandlers, TypedRpc } from "./protocol.ts";

export interface PuckEditorFrameProps {
  /** URL of the editor app. Its origin must be `editorOrigin`. */
  editorUrl: string;
  /** Origin of the editor app; must match payload.origins.editor. */
  editorOrigin: string;
  /** From core.editorPayload(): page, manifest, theme URLs, origins. */
  payload: EditorPayload;
  /** JSON-only options (permissions, locales, categories, flags). */
  options?: EditorOptions;
  /** Allow-listed RPC handlers; anything else is refused. They run with the host's session. */
  rpc?: RpcHandlers;
  /** Every validated change (debounced by the editor). */
  onChange?: (data: PageData) => void;
  onError?: (message: string) => void;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** Why the frame refuses to load, or null. */
export function frameProblem(
  p: Pick<PuckEditorFrameProps, "editorUrl" | "editorOrigin" | "payload">,
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

export interface HostHandlerOptions {
  editorOrigin: string;
  /** The iframe's window: messages from anything else are ignored. */
  source: () => unknown;
  post: (m: HostToEditor) => void;
  init: () => { payload: EditorPayload; options: EditorOptions };
  rpc: () => RpcHandlers;
  onChange: (data: PageData) => void;
  onError: (message: string) => void;
  now?: () => number;
}

/** The frame's message handling, without React or the DOM. */
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
    if (!parsed.success)
      return fail(
        `invalid message from the editor${(e.data as { v?: unknown } | null)?.v !== PROTOCOL_VERSION ? " (protocol version mismatch)" : ""}`,
      );
    const m = parsed.data;
    switch (m.type) {
      case "ready":
        post({ v: PROTOCOL_VERSION, type: "init", ...o.init() });
        return;
      case "change":
        if (size.jsonBytes > LIMITS.pageBytes)
          return fail("page data too large");
        o.onChange(m.data as PageData);
        return;
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

export function PuckEditorFrame(props: PuckEditorFrameProps) {
  const {
    editorUrl,
    editorOrigin,
    payload,
    options = {},
    title = "Page editor",
    className,
    style,
  } = props;
  const iframe = useRef<HTMLIFrameElement>(null);
  // undefined until the origin checks ran (in the browser): the iframe is never created before.
  const [problem, setProblem] = useState<string | null | undefined>(undefined);
  // Latest props without re-subscribing the listener on every render.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const p = frameProblem(props, window.location.origin);
    setProblem(p);
    if (p) return;
    const onMessage = hostMessageHandler({
      editorOrigin,
      source: () => iframe.current?.contentWindow ?? null,
      post: (m) => iframe.current?.contentWindow?.postMessage(m, editorOrigin),
      init: () => ({ payload: latest.current.payload, options }),
      rpc: () => latest.current.rpc ?? {},
      onChange: (data) => latest.current.onChange?.(data),
      onError: (message) => latest.current.onError?.(message),
    });
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // A new payload (another page or artifact) reloads the editor.
  }, [editorUrl, editorOrigin, payload.artifact, payload.slug]);

  if (problem === undefined) return null;
  if (problem)
    return (
      <div
        role="alert"
        style={{
          padding: 16,
          color: "#b91c1c",
          font: "14px system-ui, sans-serif",
        }}
      >
        Editor not loaded: {problem}
      </div>
    );
  return (
    <iframe
      key={`${payload.artifact}:${payload.slug}`}
      ref={iframe}
      src={editorUrl}
      title={title}
      className={className}
      style={{ border: 0, width: "100%", height: "100%", ...style }}
      // No top navigation, no plugins; same-origin is the editor's own origin (Puck's canvas needs it).
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      referrerPolicy="no-referrer"
    />
  );
}
