/**
 * Public page pipeline (D3): load the page from the current artifact → rewrite unknown blocks → resolve ALL data for the page
 * (host walker, dedupe, budget) → render root + every block in ONE fresh isolate context →
 * hand Puck's RSC <Render> a map of pre-rendered HTML. Puck components then only parse HTML.
 */
import type { Host } from './host.ts'
import type { RenderSession } from './runtime/types.ts'
import type { Manifest } from './manifest-schema.ts'
import { collectInstances, renderProps, restoreMissing, rewriteMissing, ROOT_ID, type Instance, type PageData } from './page-tree.ts'
import { readPage, stripResolved } from './pages.ts'
import { resolvePageData, type ResolveStats } from './query/resolver.ts'
import { assetBase, ISLAND_LIMITS, mergeEffects, newNonce, renderInIsolate, type Effect, type Island } from './render.ts'
import { themeBase } from '../shared/urls.ts'

export interface RenderedBlock {
  ok: boolean
  html: string
  nonce: string
  /** Islands in this block's HTML (theme client components, hydrated in the browser). */
  islands: Island[]
  error?: string
}

/** Per-request overrides the app may pass in (e.g. from i18n routing). */
export interface PageContext {
  locale?: string
}

export interface PreparedPage {
  /** CSP nonce for the page's <script> tags; set by framework bindings when they enforce a CSP. */
  scriptNonce?: string
  /** The artifact the page and its blocks come from. */
  artifact: string
  /** The artifact manifest the page was rendered with (to build the matching Puck config). */
  manifest: Manifest
  slug: string
  data: PageData
  rendered: Record<string, RenderedBlock>
  /** The theme's islands bundle, when this page has islands. */
  islandsUrl?: string
  head: ReturnType<typeof mergeEffects>
  cacheable: boolean
  uncacheableBlocks: string[]
  stats: { data: ResolveStats; renderMs: number; blocks: number; failures: number; contextMs: number }
}

export async function preparePage(host: Host, slug: string, query: Record<string, string>, context: PageContext = {}): Promise<PreparedPage | null> {
  const artifact = host.store.get()
  const { manifest, runtime: runner, id } = artifact
  const page = await readPage(host.config.artifacts, id, manifest, slug)
  if (!page) return null

  const tCtx = performance.now()
  let session: RenderSession | null = null
  let sessionP: Promise<RenderSession> | null = null
  const getSession = () => (sessionP ??= runner.session().then((s) => (session = s)))
  try {
    await getSession()
    const contextMs = performance.now() - tCtx
    const data = rewriteMissing(stripResolved(page), manifest)
    const instances = collectInstances(data, manifest)
    const uncacheableBlocks = [...new Set(instances.filter((i) => i.meta?.usesRequestParams).map((i) => i.name))]
    const locale = context.locale ?? host.config.site.locale
    const env = { page: { slug, locale }, site: host.config.site, query: uncacheableBlocks.length ? query : {} }
    const { byInstance, stats } = await resolvePageData(
      { instances, env, mode: 'public' },
      { manifest, config: host.config, source: host.source, http: host.http, session: getSession },
    )

    const rendered: Record<string, RenderedBlock> = {}
    const effects: Effect[][] = []
    let failures = 0
    let islandCount = 0
    const tRender = performance.now()
    for (const inst of instances) {
      if (!inst.meta) continue
      let r = await renderOne(inst, byInstance.get(inst.id) ?? {}, host, slug, id, locale, session!)
      if (r.ok && islandCount + r.islands.length > ISLAND_LIMITS.maxPerPage) {
        r = { ok: false, kind: 'invalid-output', error: `more than ${ISLAND_LIMITS.maxPerPage} islands on the page`, ms: r.ms, nonce: r.nonce, effects: [] }
      }
      if (r.ok) islandCount += r.islands.length
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
      rendered[inst.id] = { ok: r.ok, html: r.ok ? r.html : '', nonce: r.nonce, islands: r.ok ? r.islands : [], error: r.ok ? undefined : r.kind }
    }
    if (uncacheableBlocks.length) console.info(`[cache] /${slug} is uncacheable: uses request params via ${uncacheableBlocks.join(', ')}`)
    return {
      artifact: id,
      manifest,
      slug,
      data,
      rendered,
      islandsUrl: islandCount && manifest.files['bundle.islands.js'] ? `${themeBase(host.config.routes.theme, id)}bundle.islands.js` : undefined,
      head: mergeEffects(effects, assetBase(host.config.routes.theme, id), host.config.security),
      cacheable: uncacheableBlocks.length === 0,
      uncacheableBlocks,
      stats: { data: stats, renderMs: performance.now() - tRender, blocks: Object.keys(rendered).length, failures, contextMs },
    }
  } finally {
    ;(session as RenderSession | null)?.release()
  }
}

async function renderOne(inst: Instance, data: Record<string, unknown>, host: Host, slug: string, artifact: string, locale: string, session: RenderSession) {
  const nonce = newNonce()
  const r = await renderInIsolate(session, inst.kind, inst.name, renderProps(inst.props, inst.meta), data, {
    isEditing: false,
    locale,
    nonce,
    page: { slug },
    site: { name: host.config.site.name },
    assetBase: assetBase(host.config.routes.theme, artifact),
  })
  return r.ok ? { ...r, nonce, kind: undefined } : { ...r, nonce, effects: [] as Effect[] }
}

export { ROOT_ID, restoreMissing, rewriteMissing }
