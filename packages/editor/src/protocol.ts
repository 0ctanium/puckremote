/**
 * The postMessage protocol between the host's admin page (<PuckEditorFrame>) and the editor
 * iframe (the bridge). Typed, versioned messages; both sides validate everything they receive.
 *
 *   editor → host   ready, change, rpc, error
 *   host → editor   init, rpc:result, error
 *
 * Only JSON travels, except RPC params, which may also carry File/Blob values (uploads).
 * Functions never cross: the editor rebuilds the Puck config from the manifest and the theme's
 * browser bundle.
 */
import type { EditorPayload, PageData } from '@puck-remote/core'
import { z } from 'zod'

export const PROTOCOL_VERSION = 1

export const LIMITS = {
  /** Max size of one RPC request or result (JSON bytes). */
  rpcBytes: 1024 * 1024,
  /** Max total size of File/Blob values in one RPC request. */
  uploadBytes: 10 * 1024 * 1024,
  /** RPC calls per second per frame. */
  rpcPerSecond: 20,
  /** The editor sends `change` at most this often. */
  changeDebounceMs: 500,
  /** Max size of page data (JSON bytes). */
  pageBytes: 2 * 1024 * 1024,
} as const

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

/** JSON-only editor options sent with `init`. */
export interface EditorOptions {
  /** Puck global permissions. */
  permissions?: Partial<Record<'drag' | 'duplicate' | 'delete' | 'edit' | 'insert', boolean>>
  locales?: string[]
  /** Replaces the theme's block categories. */
  categories?: Record<string, { title?: string; components: string[]; defaultExpanded?: boolean; visible?: boolean }>
  flags?: Record<string, boolean>
  /** Anything else the app wants the editor to know. */
  extra?: Record<string, Json>
}

export type RpcHandler = (params: unknown) => Promise<unknown> | unknown

export type EditorToHost =
  | { v: 1; type: 'ready' }
  | { v: 1; type: 'change'; data: PageData }
  | { v: 1; type: 'rpc'; id: number; method: string; params: unknown }
  | { v: 1; type: 'error'; message: string }

export type HostToEditor =
  | { v: 1; type: 'init'; payload: EditorPayload; options: EditorOptions }
  | { v: 1; type: 'rpc:result'; id: number; ok: true; value: unknown }
  | { v: 1; type: 'rpc:result'; id: number; ok: false; error: string }
  | { v: 1; type: 'error'; message: string }

export type { EditorPayload, PageData }

const v = z.literal(PROTOCOL_VERSION)
const json: z.ZodType<Json> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]))
const item = z.object({ type: z.string().max(100), props: z.record(z.string(), z.unknown()) }).passthrough()
export const pageDataSchema = z
  .object({
    root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
    content: z.array(item),
    zones: z.record(z.string(), z.array(item)).optional(),
  })
  .passthrough()
const rpcId = z.number().int().nonnegative()
const method = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/)
const message = z.string().max(2000)

const optionsSchema = z.strictObject({
  permissions: z.strictObject({ drag: z.boolean(), duplicate: z.boolean(), delete: z.boolean(), edit: z.boolean(), insert: z.boolean() }).partial().optional(),
  locales: z.array(z.string().max(35)).max(200).optional(),
  categories: z
    .record(z.string(), z.strictObject({ title: z.string().optional(), components: z.array(z.string()), defaultExpanded: z.boolean().optional(), visible: z.boolean().optional() }))
    .optional(),
  flags: z.record(z.string(), z.boolean()).optional(),
  extra: z.record(z.string(), json).optional(),
})

const originsSchema = z.strictObject({ admin: z.array(z.string()).min(1), editor: z.string() })
const payloadSchema = z.strictObject({
  artifact: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  slug: z.string().max(200),
  // Validated by the editor when it builds the Puck config; here only its shape.
  manifest: z.object({ blocks: z.record(z.string(), z.unknown()), root: z.unknown(), categories: z.record(z.string(), z.unknown()) }).passthrough(),
  data: pageDataSchema,
  bundleUrl: z.string().url(),
  assetBase: z.string().url(),
  origins: originsSchema,
  site: z.strictObject({ name: z.string(), locale: z.string() }),
})

/** What the host accepts from the editor. */
export const editorToHostSchema = z.discriminatedUnion('type', [
  z.strictObject({ v, type: z.literal('ready') }),
  z.strictObject({ v, type: z.literal('change'), data: pageDataSchema }),
  z.strictObject({ v, type: z.literal('rpc'), id: rpcId, method, params: z.unknown() }),
  z.strictObject({ v, type: z.literal('error'), message }),
])

/** What the editor accepts from the host. */
export const hostToEditorSchema = z.union([
  z.strictObject({ v, type: z.literal('init'), payload: payloadSchema, options: optionsSchema }),
  z.strictObject({ v, type: z.literal('rpc:result'), id: rpcId, ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ v, type: z.literal('rpc:result'), id: rpcId, ok: z.literal(false), error: message }),
  z.strictObject({ v, type: z.literal('error'), message }),
])

/**
 * Size of a value: JSON bytes, plus File/Blob bytes counted separately. Anything that is
 * neither JSON nor a Blob (functions, class instances, cycles) makes it invalid (null).
 */
export function measure(value: unknown): { jsonBytes: number; blobBytes: number } | null {
  let blobBytes = 0
  const seen = new Set<object>()
  const strip = (x: unknown): unknown => {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return x
    if (typeof x === 'number') return Number.isFinite(x) ? x : undefined
    if (typeof Blob !== 'undefined' && x instanceof Blob) {
      blobBytes += x.size
      return null
    }
    if (typeof x !== 'object') throw new TypeError('not JSON')
    if (seen.has(x)) throw new TypeError('cycle')
    seen.add(x)
    if (Array.isArray(x)) return x.map(strip)
    const proto = Object.getPrototypeOf(x)
    if (proto !== Object.prototype && proto !== null) throw new TypeError('not a plain object')
    return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, strip(y)]))
  }
  try {
    const s = JSON.stringify(strip(value)) ?? ''
    return { jsonBytes: new TextEncoder().encode(s).byteLength, blobBytes }
  } catch {
    return null
  }
}

/** Token bucket: `perSecond` calls per second, bursts up to the same number. */
export function rateLimiter(perSecond: number, now: () => number = () => Date.now()) {
  let tokens = perSecond
  let last = now()
  return () => {
    const t = now()
    tokens = Math.min(perSecond, tokens + ((t - last) / 1000) * perSecond)
    last = t
    if (tokens < 1) return false
    tokens -= 1
    return true
  }
}

/** Id of the JSON block in the editor page that carries its runtime config (admin origins). */
export const CONFIG_ELEMENT_ID = 'puck-remote-editor-config'
