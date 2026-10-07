/**
 * Public page pipeline (D3): load page → rewrite unknown blocks → resolve ALL data for the page
 * (host walker, dedupe, budget) → render root + every block in ONE fresh isolate context →
 * hand Puck's RSC <Render> a map of pre-rendered HTML. Puck components then only parse HTML.
 */
import type { Host } from './host.ts'
import type { RenderSession } from './isolate-runner.ts'
import type { Manifest } from './manifest-schema.ts'
import { collectInstances, mapItems, MISSING_TYPE, renderProps, ROOT_ID, type Instance, type PageData } from './page-tree.ts'
import { readPage, stripResolved } from './pages.ts'
import { resolvePageData, type ResolveStats } from './query/resolver.ts'
import { assetBase, mergeEffects, newNonce, renderInIsolate, type Effect } from './render.ts'

export interface RenderedBlock {
  ok: boolean
  html: string
  nonce: string
  error?: string
}

/** Per-request overrides the app may pass in (e.g. from i18n routing). */
export interface PageContext {
  locale?: string
}

export interface PreparedPage {
  version: number
  /** The artifact manifest the page was rendered with (to build the matching Puck config). */
  manifest: Manifest
  slug: string
  data: PageData
  rendered: Record<string, RenderedBlock>
  head: ReturnType<typeof mergeEffects>
  cacheable: boolean
  uncacheableBlocks: string[]
  stats: { data: ResolveStats; renderMs: number; blocks: number; failures: number; contextMs: number }
}

/** D2: Puck silently drops unknown types; make them explicit so they render a fallback. */
export function rewriteMissing(data: PageData, manifest: Manifest): PageData {
  let n = 0
  return mapItems(data, manifest, (item) => {
    const id = typeof item.props.id === 'string' && item.props.id ? item.props.id : `auto-${item.type}-${n++}`
    if (item.type === MISSING_TYPE || Object.hasOwn(manifest.blocks, item.type)) return { ...item, props: { ...item.props, id } }
    return { type: MISSING_TYPE, props: { id, originalType: item.type, originalProps: item.props } }
  })
}

/** Reverse of rewriteMissing, used by the editor's save path so unknown blocks are not lost. */
export function restoreMissing(data: PageData): PageData {
  return mapItems(data, null, (item) =>
    item.type === MISSING_TYPE && typeof item.props.originalType === 'string'
      ? { type: item.props.originalType, props: (item.props.originalProps as Record<string, unknown>) ?? { id: item.props.id } }
      : item,
  )
}

export async function preparePage(host: Host, slug: string, query: Record<string, string>, context: PageContext = {}): Promise<PreparedPage | null> {
  const artifact = host.store.get()
  const { manifest, runtime: runner, version } = artifact
  const page = await readPage(host.config.pages, slug)
  if (!page) return null
  const data = rewriteMissing(stripResolved(page), manifest)
  const instances = collectInstances(data, manifest)
  const uncacheableBlocks = [...new Set(instances.filter((i) => i.meta?.usesRequestParams).map((i) => i.name))]

  const tCtx = performance.now()
  let session: RenderSession | null = null
  let sessionP: Promise<RenderSession> | null = null
  const getSession = () => (sessionP ??= runner.session().then((s) => (session = s)))
  try {
    await getSession()
    const contextMs = performance.now() - tCtx
    const locale = context.locale ?? host.config.site.locale
    const env = { page: { slug, locale }, site: host.config.site, query: uncacheableBlocks.length ? query : {} }
    const { byInstance, stats } = await resolvePageData(
      { instances, env, mode: 'public' },
      { manifest, config: host.config, source: host.source, http: host.http, cache: host.cache, session: getSession },
    )

    const rendered: Record<string, RenderedBlock> = {}
    const effects: Effect[][] = []
    let failures = 0
    const tRender = performance.now()
    for (const inst of instances) {
      if (!inst.meta) continue
      const r = await renderOne(inst, byInstance.get(inst.id) ?? {}, host, slug, version, locale, session!)
      if (!r.ok && ['memory', 'disposed'].includes(r.kind!)) {
        // The isolate died (OOM / watchdog). Later blocks get a fresh isolate + context.
        session!.release()
        sessionP = null
        await getSession()
      }
      if (!r.ok) {
        failures++
        console.error(`[render] block ${inst.name}#${inst.id} failed (${r.kind}): ${r.error}`)
      } else effects.push(r.effects)
      rendered[inst.id] = { ok: r.ok, html: r.ok ? r.html : '', nonce: r.nonce, error: r.ok ? undefined : r.kind }
    }
    if (uncacheableBlocks.length) console.info(`[cache] /${slug} is uncacheable: uses request params via ${uncacheableBlocks.join(', ')}`)
    return {
      version,
      manifest,
      slug,
      data,
      rendered,
      head: mergeEffects(effects, assetBase(host.config.routes.theme, version)),
      cacheable: uncacheableBlocks.length === 0,
      uncacheableBlocks,
      stats: { data: stats, renderMs: performance.now() - tRender, blocks: Object.keys(rendered).length, failures, contextMs },
    }
  } finally {
    ;(session as RenderSession | null)?.release()
  }
}

async function renderOne(inst: Instance, data: Record<string, unknown>, host: Host, slug: string, version: number, locale: string, session: RenderSession) {
  const nonce = newNonce()
  const r = await renderInIsolate(session, inst.kind, inst.name, renderProps(inst.props, inst.meta), data, {
    isEditing: false,
    locale,
    nonce,
    page: { slug },
    site: { name: host.config.site.name },
    assetBase: assetBase(host.config.routes.theme, version),
  })
  return r.ok ? { ...r, nonce, kind: undefined } : { ...r, nonce, effects: [] as Effect[] }
}

export { ROOT_ID }
