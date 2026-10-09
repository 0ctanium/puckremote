import { randomBytes } from 'node:crypto'
import render from 'dom-serializer'
import { htmlToDOM } from 'html-react-parser'
import { z } from 'zod'
import type { RenderSession, IsolateErrorKind } from './runtime/types.ts'

/** JSON ctx passed into the isolate (functions are attached on the other side). */
export interface CtxInput {
  isEditing: boolean
  locale: string
  nonce: string
  page: { slug: string }
  site: { name: string }
  assetBase: string
  /** Versions of the theme's assets (path below assets/ → v), appended by ctx.assetUrl. */
  assetVersions: Record<string, string>
}

const str = z.string().max(2048)
const effectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('title'), value: str }),
  z.strictObject({ kind: z.literal('meta'), name: z.string().regex(/^[\w:.-]{1,64}$/), content: str }),
  z.strictObject({
    kind: z.literal('script'),
    url: str,
    opts: z.strictObject({ defer: z.boolean(), async: z.boolean(), module: z.boolean() }),
  }),
  z.strictObject({ kind: z.literal('style'), url: str }),
])
export type Effect = z.infer<typeof effectSchema>

// Same values as @puck-remote/sdk/constants (the host never imports theme-facing SDK modules).
export const HYDRATE_MODES = ['load', 'idle', 'visible'] as const
export const ISLAND_LIMITS = { maxPropsBytes: 64 * 1024, maxPerPage: 200 } as const

// Isolate output is untrusted: re-check what the SDK runtime promises about islands.
const islandSchema = z.strictObject({
  key: z.string().regex(/^i\d{1,4}$/),
  id: z.string().regex(/^[^#\s]{1,256}#[A-Za-z_$][\w$]{0,127}$/),
  props: z.record(z.string(), z.unknown()).refine((p) => JSON.stringify(p).length <= ISLAND_LIMITS.maxPropsBytes, 'island props too large'),
  hydrate: z.enum(HYDRATE_MODES),
  html: z.string(),
})
export type Island = z.infer<typeof islandSchema>

const outputSchema = z.strictObject({
  html: z.string(),
  effects: z.array(effectSchema).max(64),
  islands: z.array(islandSchema).max(ISLAND_LIMITS.maxPerPage),
})

export type RenderResult =
  | { ok: true; html: string; effects: Effect[]; islands: Island[]; ms: number }
  | { ok: false; error: string; kind: IsolateErrorKind | 'invalid-output'; ms: number }

export const newNonce = () => randomBytes(16).toString('hex')

/** Public URL prefix of an artifact version's assets, e.g. /theme/v3/assets/. */
export { assetVersions, themeAssetBase as assetBase } from '../shared/urls.ts'

export async function renderInIsolate(
  session: RenderSession,
  kind: 'block' | 'root',
  name: string,
  props: Record<string, unknown>,
  data: Record<string, unknown>,
  ctx: CtxInput,
): Promise<RenderResult> {
  const t = performance.now()
  const res = await session.call('__render', [kind, name, JSON.stringify(props), JSON.stringify(data), JSON.stringify(ctx)])
  const ms = performance.now() - t
  if (!res.ok) return { ok: false, error: res.error, kind: res.kind, ms }
  let parsed: unknown
  try {
    parsed = JSON.parse(res.value)
  } catch {
    return { ok: false, kind: 'invalid-output', error: 'render output is not JSON', ms }
  }
  const out = outputSchema.safeParse(parsed)
  if (!out.success) return { ok: false, kind: 'invalid-output', error: `invalid render output: ${out.error.issues[0]?.message}`, ms }
  // Island HTML reaches the page raw (a separate React root hydrates it): re-serialize it so
  // unbalanced markup can't escape the island's wrapper.
  const islands = out.data.islands.map((i) => ({ ...i, html: render(htmlToDOM(i.html) as never) }))
  return { ok: true, html: out.data.html, effects: out.data.effects, islands, ms }
}

/**
 * Merge and dedupe effects from all blocks of a page. URLs are restricted to this artifact's
 * assets or absolute https URLs (Shopify-like permissiveness for third-party scripts).
 */
export function mergeEffects(all: Effect[][], base: string, allow: { scriptOrigins: string[]; styleOrigins: string[] } = { scriptOrigins: [], styleOrigins: [] }): {
  title: string | null
  meta: { name: string; content: string }[]
  styles: string[]
  scripts: { url: string; defer: boolean; async: boolean; module: boolean }[]
} {
  // The theme's own assets are always fine; other origins only if the host allowlisted them.
  const okUrl = (u: string, origins: string[]) => {
    if (u.startsWith(base)) return !u.includes('..')
    try {
      const url = new URL(u)
      return url.protocol === 'https:' && origins.includes(url.origin)
    } catch {
      return false
    }
  }
  let title: string | null = null
  const meta = new Map<string, string>()
  const styles = new Set<string>()
  const scripts = new Map<string, { url: string; defer: boolean; async: boolean; module: boolean }>()
  for (const list of all) {
    for (const e of list) {
      if (e.kind === 'title') title ??= e.value
      else if (e.kind === 'meta') {
        if (!meta.has(e.name)) meta.set(e.name, e.content)
      } else if (e.kind === 'style') {
        if (okUrl(e.url, allow.styleOrigins)) styles.add(e.url)
      } else if (e.kind === 'script') {
        if (okUrl(e.url, allow.scriptOrigins) && !scripts.has(e.url)) scripts.set(e.url, { url: e.url, ...e.opts })
      }
    }
  }
  return { title, meta: [...meta].map(([name, content]) => ({ name, content })), styles: [...styles], scripts: [...scripts.values()] }
}
