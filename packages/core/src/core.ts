/**
 * The framework-agnostic host runtime: loads remote theme artifacts (code + pages), renders
 * pages in the sandbox, resolves declarative data, and reads/writes pages inside artifacts.
 * Saving, publishing, drafts and history are left to plugins built on readPage/writePage and the
 * artifact pointer. Frameworks bind to it through plain functions (see @puck-remote/next).
 */
import type { ArtifactId } from '@puck-remote/sdk/host'
import { ConfigError, resolveConfig, type EditorOrigins, type HostConfig, type PuckRemoteConfig } from './server/config.ts'
import { isArtifactId } from './server/artifact-loader.ts'
import { blockDataSchema, resolveBlock, type BlockDataResult } from './server/editor-rpc.ts'
import { createHost, type Host } from './server/host.ts'
import { manifestSchema, type Manifest } from './server/manifest-schema.ts'
import { rewriteMissing, type PageData } from './server/page-tree.ts'
import { readPage, stripResolved, writePage } from './server/pages.ts'
import { preparePage, type PageContext, type PreparedPage } from './server/public-render.ts'
import type { RenderSession } from './server/runtime/types.ts'
import { fileResponse, readArtifactFile } from './server/static-files.ts'
import { themeAssetBase, themeBase } from './shared/urls.ts'

/** Everything the editor iframe needs to edit a page (JSON only; sent in the `init` message). */
export interface EditorPayload {
  artifact: ArtifactId
  slug: string
  manifest: Manifest
  /** The page (unknown blocks shown as placeholders), or an empty page when the artifact has none. */
  data: PageData
  /** Absolute URL of the theme's browser bundle (ESM). */
  bundleUrl: string
  /** Absolute URL prefix of the theme's assets. */
  assetBase: string
  /** Where the frame and the editor must run; both sides check them. */
  origins: EditorOrigins
  /** For the render context of blocks in the editor. */
  site: { name: string; locale: string }
}

export interface PuckRemoteCore {
  config: HostConfig
  /** Resolves once the first artifact load was attempted (loads lazily on first use). */
  host(): Promise<Host>
  /** Resolve data and render every block of a page of the current artifact. null: no such page. */
  preparePage(slug: string, query?: Record<string, string>, context?: PageContext): Promise<PreparedPage | null>
  /** A page of an artifact (default: the current one), or null when it has no such page. */
  readPage(slug: string, opts?: { artifact?: ArtifactId }): Promise<{ artifact: ArtifactId; data: PageData } | null>
  /**
   * Write a page into a copy of `base` and return the new artifact's id. Never moves the
   * pointer: going live is `config.artifacts.writePointer(id)`, decided by the caller.
   */
  writePage(slug: string, data: unknown, opts: { base: ArtifactId }): Promise<{ id: ArtifactId }>
  /** Data for one block in draft mode (the editor's resolveData). Only block name + props come from the caller. */
  resolveBlockData(slug: string, block: string, props: Record<string, unknown>): Promise<BlockDataResult>
  /** What the admin page passes to <PuckEditorFrame>: page, manifest and theme URLs. Needs `origins`. */
  editorPayload(slug: string, opts?: { artifact?: ArtifactId }): Promise<EditorPayload>
  /** `<routes.theme>/<id>/assets/**` and `<routes.theme>/<id>/bundle.browser.js` (GET/HEAD); CORS for the editor origin. */
  handleTheme(request: Request): Promise<Response>
}

/** Path below a route prefix, or null if the request is outside it. */
function subpath(request: Request, prefix: string): string | null {
  const { pathname } = new URL(request.url)
  const p = prefix.replace(/\/+$/, '')
  if (pathname !== p && !pathname.startsWith(p + '/')) return null
  return pathname.slice(p.length).replace(/^\/+/, '')
}

function build(config: HostConfig): PuckRemoteCore {
  let hostP: Promise<Host> | null = null
  const host = () =>
    (hostP ??= (async () => {
      const h = createHost(config)
      const r = await h.store.reload()
      if (!r.ok) console.error('[puck-remote] no artifact could be loaded at startup:', r.error)
      h.store.watch(config.artifactPollMs)
      return h
    })())

  /** The current artifact's manifest, or a stored one (validated). */
  async function manifestOf(h: Host, id?: ArtifactId): Promise<{ id: ArtifactId; manifest: Manifest } | null> {
    const current = h.store.peek()
    if (!id || id === current?.id) return current ? { id: current.id, manifest: current.manifest } : null
    if (!isArtifactId(id)) return null
    const bytes = await config.artifacts.readFile(id, 'manifest.json')
    if (!bytes) return null
    const parsed = manifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    return parsed.success ? { id, manifest: parsed.data } : null
  }

  return {
    config,
    host,
    async preparePage(slug, query = {}, context = {}) {
      return preparePage(await host(), slug, query, context)
    },
    async readPage(slug, opts = {}) {
      const m = await manifestOf(await host(), opts.artifact)
      if (!m) return null
      const data = await readPage(config.artifacts, m.id, m.manifest, slug)
      return data ? { artifact: m.id, data } : null
    },
    async writePage(slug, data, opts) {
      return writePage(config.artifacts, opts.base, slug, data)
    },
    async resolveBlockData(slug, block, props) {
      const input = blockDataSchema.parse({ slug, block, props })
      const h = await host()
      const { manifest, runtime } = h.store.get()
      let session: Promise<RenderSession> | null = null
      try {
        return await resolveBlock(input, {
          manifest,
          config,
          source: h.source,
          http: h.http,
          site: config.site,
          session: () => (session ??= runtime.session()),
        })
      } finally {
        if (session) (await (session as Promise<RenderSession>).catch(() => null))?.release()
      }
    },
    async editorPayload(slug, opts = {}) {
      const origins = config.origins
      if (!origins) throw new ConfigError('puck-remote: `origins` ({ admin, editor }) is required to use the editor')
      const m = await manifestOf(await host(), opts.artifact)
      if (!m) throw new Error(opts.artifact ? `artifact ${opts.artifact} not found` : 'no artifact loaded')
      const page = (await readPage(config.artifacts, m.id, m.manifest, slug)) ?? { root: { props: { ...(m.manifest.root?.defaultProps ?? {}) } }, content: [] }
      const base = origins.admin[0]
      return {
        artifact: m.id,
        slug,
        manifest: m.manifest,
        data: rewriteMissing(stripResolved(page), m.manifest),
        bundleUrl: `${base}${themeBase(config.routes.theme, m.id)}bundle.browser.js`,
        assetBase: `${base}${themeAssetBase(config.routes.theme, m.id)}`,
        origins,
        site: config.site,
      }
    },
    async handleTheme(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
      const sub = subpath(request, config.routes.theme)
      const m = sub === null ? null : /^([A-Za-z0-9._-]{1,128})\/(.+)$/.exec(sub)
      const res = fileResponse(m ? await readArtifactFile(config.artifacts, m[1], m[2]) : null)
      // The editor (another origin) loads the browser bundle as a module and the assets in its canvas.
      if (config.origins && res.ok) {
        res.headers.set('access-control-allow-origin', config.origins.editor)
        res.headers.set('vary', 'origin')
        res.headers.set('cross-origin-resource-policy', 'cross-origin')
      }
      return res
    },
  }
}

/**
 * Process-wide runtime for a config, memoized on globalThis by `config.id` so every route
 * bundle (and dev HMR) shares one artifact store, isolate and file watcher.
 */
export function createCore(input: PuckRemoteConfig): PuckRemoteCore {
  const config = resolveConfig(input)
  const key = Symbol.for(`remote.core:${config.id}`)
  const g = globalThis as typeof globalThis & { [k: symbol]: PuckRemoteCore | undefined }
  return (g[key] ??= build(config))
}
