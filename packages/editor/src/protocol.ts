/**
 * The postMessage protocol between the host's admin page (<PuckEditorFrame>, which holds the page
 * data, the history and the fields) and the editor iframe (<PuckRemoteEditor>: canvas, drawer,
 * outline; theme code runs there). Typed, versioned messages; both sides validate everything.
 *
 *   editor → host   ready, action { seq, action }, intent { undo | redo }, rpc, error
 *   host → editor   init, state { data, itemSelector, ack }, ui { leftSideBarVisible, plugin }, rpc:result, error
 *
 * The editor proposes Puck actions; the host validates and replays them on its own Puck, then
 * sends its state back. Only JSON travels, except RPC params, which may also carry File/Blob
 * values (uploads). Functions never cross: each side builds its own Puck config.
 */
import type { EditorPayload, PageData } from "@puck-remote/core";
import { z } from "zod";

export const PROTOCOL_VERSION = 2;

export const LIMITS = {
  /** Max size of one RPC request or result (JSON bytes). */
  rpcBytes: 1024 * 1024,
  /** Max total size of File/Blob values in one RPC request. */
  uploadBytes: 10 * 1024 * 1024,
  /** RPC calls per second per frame (actions are not rate-limited). */
  rpcPerSecond: 20,
  /** Max size of page data (JSON bytes). */
  pageBytes: 2 * 1024 * 1024,
} as const;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** JSON-only editor options sent with `init`. */
export interface EditorOptions {
  /** Puck global permissions. */
  permissions?: Partial<
    Record<"drag" | "duplicate" | "delete" | "edit" | "insert", boolean>
  >;
  locales?: string[];
  /** Replaces the theme's block categories. */
  categories?: Record<
    string,
    {
      title?: string;
      components: string[];
      defaultExpanded?: boolean;
      visible?: boolean;
    }
  >;
  flags?: Record<string, boolean>;
  /** Anything else the app wants the editor to know. */
  extra?: Record<string, Json>;
}

export type RpcHandler<P = any, R = any> = (params: P) => Promise<R> | R;

/** The `rpc` map an admin page passes to <PuckEditorFrame>; its type also types the editor's calls. */
export type RpcHandlers = Record<string, RpcHandler>;

/** Arguments after the method name: none, an optional or a required params value. */
type RpcParams<H> = H extends (...args: infer A) => unknown
  ? A extends []
    ? []
    : undefined extends A[0]
      ? [params?: A[0]]
      : [params: A[0]]
  : [params?: unknown];

/**
 * `rpc(method, params)` typed by an admin page's handler map: method names, params and results
 * come from `T` (`useEditor<typeof rpc>()`). Results cross postMessage, so handlers return JSON.
 */
export type TypedRpc<T extends RpcHandlers = RpcHandlers> = <K extends keyof T & string>(
  method: K,
  ...params: RpcParams<T[K]>
) => Promise<Awaited<ReturnType<T[K]>>>;

/** The selected block (Puck's `ui.itemSelector`), or null for the root. */
export type ItemSelector = { index: number; zone?: string } | null;

type Item = { type: string; props: Record<string, unknown> };

/** The Puck actions the editor may propose (B6). Everything else stays local or is refused. */
export type FrameAction =
  | { type: "insert"; componentType: string; destinationIndex: number; destinationZone: string; id?: string }
  | { type: "duplicate"; sourceIndex: number; sourceZone: string }
  | { type: "reorder"; sourceIndex: number; destinationIndex: number; destinationZone: string }
  | { type: "move"; sourceIndex: number; sourceZone: string; destinationIndex: number; destinationZone: string }
  | { type: "remove"; index: number; zone: string }
  | { type: "replace"; destinationIndex: number; destinationZone: string; data: Item }
  | { type: "replaceRoot"; root: { props?: Record<string, unknown> } }
  | { type: "setUi"; ui: { itemSelector: ItemSelector } };

type V = typeof PROTOCOL_VERSION;

export type EditorToHost =
  | { v: V; type: "ready" }
  | { v: V; type: "action"; seq: number; action: FrameAction }
  | { v: V; type: "intent"; intent: "undo" | "redo" }
  | { v: V; type: "rpc"; id: number; method: string; params: unknown }
  | { v: V; type: "error"; message: string };

export type HostToEditor =
  | { v: V; type: "init"; payload: EditorPayload; options: EditorOptions }
  | { v: V; type: "state"; data: PageData; itemSelector: ItemSelector; ack: number }
  | { v: V; type: "ui"; leftSideBarVisible: boolean; plugin: string | null }
  | { v: V; type: "rpc:result"; id: number; ok: true; value: unknown }
  | { v: V; type: "rpc:result"; id: number; ok: false; error: string }
  | { v: V; type: "error"; message: string };

export type { EditorPayload, PageData };

const v = z.literal(PROTOCOL_VERSION);
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
const item = z
  .object({
    type: z.string().max(100),
    props: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export const pageDataSchema = z
  .object({
    root: z
      .object({ props: z.record(z.string(), z.unknown()).optional() })
      .passthrough(),
    content: z.array(item),
    zones: z.record(z.string(), z.array(item)).optional(),
  })
  .passthrough();
const rpcId = z.number().int().nonnegative();
const index = z.number().int().nonnegative().max(100_000);
const zone = z.string().max(500);
const itemSelector = z.object({ index, zone: zone.optional() }).nullable();

/**
 * Frame actions (B6). `z.object` strips unknown keys, so only these fields are ever replayed.
 * Block types are checked against the manifest by the host (it knows the theme).
 */
export const frameActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("insert"), componentType: z.string().max(100), destinationIndex: index, destinationZone: zone, id: z.string().max(200).optional() }),
  z.object({ type: z.literal("duplicate"), sourceIndex: index, sourceZone: zone }),
  z.object({ type: z.literal("reorder"), sourceIndex: index, destinationIndex: index, destinationZone: zone }),
  z.object({ type: z.literal("move"), sourceIndex: index, sourceZone: zone, destinationIndex: index, destinationZone: zone }),
  z.object({ type: z.literal("remove"), index, zone }),
  z.object({ type: z.literal("replace"), destinationIndex: index, destinationZone: zone, data: item }),
  z.object({ type: z.literal("replaceRoot"), root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough() }),
  z.object({ type: z.literal("setUi"), ui: z.object({ itemSelector }) }),
]);
const method = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/);
const message = z.string().max(2000);

const optionsSchema = z.strictObject({
  permissions: z
    .strictObject({
      drag: z.boolean(),
      duplicate: z.boolean(),
      delete: z.boolean(),
      edit: z.boolean(),
      insert: z.boolean(),
    })
    .partial()
    .optional(),
  locales: z.array(z.string().max(35)).max(200).optional(),
  categories: z
    .record(
      z.string(),
      z.strictObject({
        title: z.string().optional(),
        components: z.array(z.string()),
        defaultExpanded: z.boolean().optional(),
        visible: z.boolean().optional(),
      }),
    )
    .optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
  extra: z.record(z.string(), json).optional(),
});

const originsSchema = z.strictObject({
  host: z.array(z.string()).min(1),
  editor: z.string(),
});
const payloadSchema = z.strictObject({
  artifact: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  slug: z.string().max(200),
  // Validated by the editor when it builds the Puck config; here only its shape.
  manifest: z
    .object({
      blocks: z.record(z.string(), z.unknown()),
      root: z.unknown(),
      categories: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
  data: pageDataSchema,
  bundleUrl: z.string().url(),
  assetBase: z.string().url(),
  origins: originsSchema,
  site: z.strictObject({ name: z.string(), locale: z.string() }),
});

/** What the host accepts from the editor. */
export const editorToHostSchema = z.discriminatedUnion("type", [
  z.strictObject({ v, type: z.literal("ready") }),
  z.strictObject({ v, type: z.literal("action"), seq: z.number().int().positive(), action: frameActionSchema }),
  z.strictObject({ v, type: z.literal("intent"), intent: z.enum(["undo", "redo"]) }),
  z.strictObject({
    v,
    type: z.literal("rpc"),
    id: rpcId,
    method,
    params: z.unknown(),
  }),
  z.strictObject({ v, type: z.literal("error"), message }),
]);

/** What the editor accepts from the host. */
export const hostToEditorSchema = z.union([
  z.strictObject({
    v,
    type: z.literal("init"),
    payload: payloadSchema,
    options: optionsSchema,
  }),
  z.strictObject({ v, type: z.literal("state"), data: pageDataSchema, itemSelector, ack: z.number().int().nonnegative() }),
  // `plugin`: the frame plugin whose panel the editor shows (null: none).
  z.strictObject({ v, type: z.literal("ui"), leftSideBarVisible: z.boolean(), plugin: z.string().min(1).max(64).nullable() }),
  z.strictObject({
    v,
    type: z.literal("rpc:result"),
    id: rpcId,
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.strictObject({
    v,
    type: z.literal("rpc:result"),
    id: rpcId,
    ok: z.literal(false),
    error: message,
  }),
  z.strictObject({ v, type: z.literal("error"), message }),
]);

/**
 * Size of a value: JSON bytes, plus File/Blob bytes counted separately. Anything that is
 * neither JSON nor a Blob (functions, class instances, cycles) makes it invalid (null).
 */
export function measure(
  value: unknown,
): { jsonBytes: number; blobBytes: number } | null {
  let blobBytes = 0;
  const seen = new Set<object>();
  const strip = (x: unknown): unknown => {
    if (x === null || typeof x === "string" || typeof x === "boolean") return x;
    if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
    if (typeof Blob !== "undefined" && x instanceof Blob) {
      blobBytes += x.size;
      return null;
    }
    if (typeof x !== "object") throw new TypeError("not JSON");
    if (seen.has(x)) throw new TypeError("cycle");
    seen.add(x);
    if (Array.isArray(x)) return x.map(strip);
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError("not a plain object");
    return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, strip(y)]));
  };
  try {
    const s = JSON.stringify(strip(value)) ?? "";
    return { jsonBytes: new TextEncoder().encode(s).byteLength, blobBytes };
  } catch {
    return null;
  }
}

/** Token bucket: `perSecond` calls per second, bursts up to the same number. */
export function rateLimiter(
  perSecond: number,
  now: () => number = () => Date.now(),
) {
  let tokens = perSecond;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(perSecond, tokens + ((t - last) / 1000) * perSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
