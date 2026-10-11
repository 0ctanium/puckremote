/**
 * Public render pipeline (D3): load a template from the main theme (or a previewed one) → rewrite unknown blocks → resolve ALL data for the page
 * (host walker, dedupe, budget) → render root + every block in ONE fresh isolate context →
 * hand Puck's RSC <Render> a map of pre-rendered HTML. Puck components then only parse HTML.
 */
import type { Host } from './host.ts'
import type { ThemeRole } from '@puck-remote/sdk/host'
import type { LoadedArtifact } from './artifact-loader.ts'
import type { RenderRuntime, RenderSession } from './runtime/types.ts'
import type { Manifest } from './manifest-schema.ts'
import { collectInstances, renderProps, restoreMissing, rewriteMissing, ROOT_ID, type Instance, type TemplateData } from './page-tree.ts'
import { checkParams, readTemplate, stripResolved } from './templates.ts'
import { resolvePageData, type ResolveStats } from './query/resolver.ts'
import { assetBase, assetVersions, ISLAND_LIMITS, mergeEffects, newNonce, renderInIsolate, type Effect, type Island } from './render.ts'
import { themeFileUrl } from '../shared/urls.ts'

export interface RenderedBlock {
  ok: boolean
  html: string
  nonce: string
  /** Islands in this block's HTML (theme client components, hydrated in the browser). */
  islands: Island[]
  error?: string
}

/** What the app passes with a template: its params, the request's search params, a locale. */
export interface TemplateOptions {
  /** Page-specific data (e.g. { handle }), read by `$params` refs and `ctx.params`. */
  params?: Record<string, string>
  /** URL search params of the request, read by `$query` refs. */
  query?: Record<string, string>
  /** Overrides the site locale (e.g. from i18n routing). */
  locale?: string
  /**
   * Render this theme (id) instead of the main one (a preview). Unknown theme: null, like an
   * unknown template. Framework bindings set it from the preview cookie.
   */
  theme?: string
  /** A `puck-remote dev` live reload server (loopback origin) the preview page listens to. Ignored without `theme`. */
  reload?: string
}

export interface PreparedTemplate {
  /** CSP nonce for the template's <script> tags; set by framework bindings when they enforce a CSP. */
  scriptNonce?: string
  /** The theme (and its version) the template and its blocks come from. */
  theme: { id: string; hash: string }
  /** The theme manifest the template was rendered with (to build the matching Puck config). */
  manifest: Manifest
  template: string
  params: Record<string, string>
  data: TemplateData
  rendered: Record<string, RenderedBlock>
  /** The theme's islands bundle, when this template has islands. */
  islandsUrl?: string
  head: ReturnType<typeof mergeEffects>
  /** Set when the template was rendered from `TemplateOptions.theme` (a preview): never cache it. */
  preview?: { theme: { id: string; name: string; role: ThemeRole }; reload?: string }
  cacheable: boolean
  uncacheableBlocks: string[]
  stats: { data: ResolveStats; renderMs: number; blocks: number; failures: number; contextMs: number }
}

export async function prepareTemplate(
  host: Host,
  name: string,
  opts: TemplateOptions = {},
  artifact: LoadedArtifact<RenderRuntime> = host.store.get(),
): Promise<PreparedTemplate | null> {
  const params = checkParams(opts.params)
  const query = opts.query ?? {}
  const { manifest, runtime: runner } = artifact
  const template = await readTemplate(host.config.artifacts, artifact.theme, manifest, name)
  if (!template) return null

  const tCtx = performance.now()
  let session: RenderSession | null = null
  let sessionP: Promise<RenderSession> | null = null
  const getSession = () => (sessionP ??= runner.session().then((s) => (session = s)))
  try {
    await getSession()
    const contextMs = performance.now() - tCtx
    const data = rewriteMissing(stripResolved(template), manifest)
    const instances = collectInstances(data, manifest)
    const uncacheableBlocks = [...new Set(instances.filter((i) => i.meta?.usesRequestParams).map((i) => i.name))]
    const locale = opts.locale ?? host.config.site.locale
    const env = { template: { name, locale }, params, site: host.config.site, query: uncacheableBlocks.length ? query : {} }
    const { byInstance, stats } = await resolvePageData(
      { instances, env, mode: 'public' },
      { manifest, config: host.config, source: host.source, http: host.http, session: getSession },
    )

    const rendered: Record<string, RenderedBlock> = {}
    const effects: Effect[][] = []
    let failures = 0
    let islandCount = 0
    const versions = assetVersions(manifest.files)
    const tRender = performance.now()
    for (const inst of instances) {
      if (!inst.meta) continue
      let r = await renderOne(inst, byInstance.get(inst.id) ?? {}, host, { name, params }, versions, locale, session!)
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
    if (uncacheableBlocks.length) console.info(`[cache] template ${name} is uncacheable: uses request params via ${uncacheableBlocks.join(', ')}`)
    return {
      theme: { id: artifact.theme, hash: artifact.hash },
      manifest,
      template: name,
      params,
      data,
      rendered,
      islandsUrl: islandCount && manifest.files['bundle.islands.js'] ? themeFileUrl(host.config.routes.theme, 'bundle.islands.js', manifest.files['bundle.islands.js']) : undefined,
      head: mergeEffects(effects, assetBase(host.config.routes.theme), host.config.security),
      cacheable: uncacheableBlocks.length === 0,
      uncacheableBlocks,
      stats: { data: stats, renderMs: performance.now() - tRender, blocks: Object.keys(rendered).length, failures, contextMs },
    }
  } finally {
    ;(session as RenderSession | null)?.release()
  }
}

async function renderOne(inst: Instance, data: Record<string, unknown>, host: Host, template: { name: string; params: Record<string, string> }, versions: Record<string, string>, locale: string, session: RenderSession) {
  const nonce = newNonce()
  const r = await renderInIsolate(session, inst.kind, inst.name, renderProps(inst.props, inst.meta), data, {
    isEditing: false,
    locale,
    nonce,
    template: { name: template.name },
    params: template.params,
    site: { name: host.config.site.name },
    assetBase: assetBase(host.config.routes.theme),
    assetVersions: versions,
  })
  return r.ok ? { ...r, nonce, kind: undefined } : { ...r, nonce, effects: [] as Effect[] }
}

export { ROOT_ID, restoreMissing, rewriteMissing }
