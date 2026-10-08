import type { AnyDataSource, ArtifactStore, AuthAdapter, CacheStore, PageStore } from '@puck-remote/sdk/host'
import type { RendererFactory } from './runtime/types.ts'
import { DEFAULT_SECURITY, normalizeOrigin, type OriginsConfig, type SecurityPolicy } from './surface.ts'
import { memoryCache } from './query/cache.ts'

export interface SecretDef {
  value: string
  /** Origins this secret may be sent to. Anything else is rejected. */
  origins: string[]
}

/** Fully resolved configuration used by the core. */
export interface HostConfig {
  id: string
  routes: Routes
  /** Pluggable, trusted host plugins chosen by the app. */
  artifacts: ArtifactStore
  /** How often to poll the artifact pointer when the store has no change feed. */
  artifactPollMs: number
  source: AnyDataSource
  pages: PageStore
  cache: CacheStore
  /** Where theme code runs. null → the host's default (see host.ts). */
  renderer: RendererFactory | null
  /** Required in production (see resolveConfig). */
  auth: AuthAdapter | null
  /**
   * Origins allowed to send mutating API requests (CSRF). Default: the request's own origin
   * only. Add the editor origin here when the API is called cross-origin.
   */
  allowedOrigins: string[]
  /**
   * Which hostnames serve which surface (see surface.ts). null = single-origin mode, allowed in
   * development only (or with allowSharedOrigin).
   */
  origins: OriginsConfig | null
  /** CSP and related policy (see surface.ts securityHeaders). */
  security: SecurityPolicy
  site: { name: string; locale: string }
  isolate: {
    memoryLimitMb: number
    /** Per-call CPU timeout enforced by isolated-vm. */
    callTimeoutMs: number
    /** Host-side wall-clock watchdog; on overrun the isolate is disposed. */
    watchdogMs: number
    maxInputBytes: number
    maxOutputBytes: number
  }
  budget: {
    maxQueries: number
    maxResponseBytes: number
    maxWallMs: number
  }
  http: {
    /** Origins blocks/adapters may reach. Must also match the block's declared origin. */
    allowedOrigins: string[]
    /**
     * Origins exempt from https + public-IP rules. Dev/test only (the mock API on localhost).
     * Never set in production.
     */
    insecureDevOrigins: string[]
    timeoutMs: number
    maxResponseBytes: number
    maxRedirects: number
    cacheTtlMs: number
  }
  secrets: Record<string, SecretDef>
}

export interface Routes {
  /** Prefix of the catch-all API route (pages, blocks/resolve, artifact/reload). */
  api: string
  /** Prefix of the catch-all theme route (bundle.js and assets). */
  theme: string
  /** Prefix of the editor pages. */
  editor: string
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] }

/** What an app provides. Everything except paths and plugins has a default. */
type Plugins = 'artifacts' | 'source' | 'pages' | 'cache' | 'auth' | 'secrets' | 'allowedOrigins' | 'renderer' | 'origins' | 'security'

/** What an app provides. Everything except the storage plugins has a default. */
export interface PuckRemoteConfig extends DeepPartial<Omit<HostConfig, Plugins>> {
  /** Distinguishes runtimes if one process hosts several sites. Default 'default'. */
  id?: string
  artifacts: ArtifactStore
  source: AnyDataSource
  pages: PageStore
  /** Default: in-process memory (single instance). Plug a shared store (Redis…) for clusters. */
  cache?: CacheStore
  /** Where theme code runs: workerPoolRenderer() (default) or inProcessRenderer(). */
  renderer?: RendererFactory | null
  /** Who may open the editor, read drafts, save pages, switch artifacts. Mandatory in production. */
  auth?: AuthAdapter
  allowedOrigins?: string[]
  /**
   * Public site and editor origins, e.g. { site: ['https://www.example.com'], editor: ['https://admin.example.com'] }.
   * Required in production: theme scripts run on the site origin and must not share it with the
   * editor's session. Point both DNS names at the same app.
   */
  origins?: OriginsConfig | null
  /** CSP and related headers; see DEFAULT_SECURITY. */
  security?: Partial<Omit<SecurityPolicy, 'csp'>> & { csp?: Partial<SecurityPolicy['csp']> }
  /** Escape hatch: serve site and editor from one origin in production (not recommended). */
  allowSharedOrigin?: boolean
  secrets?: Record<string, SecretDef>
}

export class ConfigError extends Error {}

/** Typed identity: use in the app's puck-remote.config.ts. Safe to import from proxy/edge code. */
export function defineConfig<C extends PuckRemoteConfig>(config: C): C {
  return config
}

export const DEFAULT_ROUTES: Routes = { api: '/api', theme: '/theme', editor: '/editor' }

function requireAuthInProduction(auth: AuthAdapter | undefined): AuthAdapter | null {
  if (auth) return auth
  if (process.env.NODE_ENV === 'production') {
    throw new ConfigError('puck-remote: `auth` is required in production. The editor and its API would otherwise be open to anyone.')
  }
  console.warn('[puck-remote] no `auth` configured: editor and API are OPEN (development only)')
  return null
}

function resolveOrigins(input: PuckRemoteConfig): OriginsConfig | null {
  const raw = input.origins
  if (raw) {
    const origins = { site: raw.site.map(normalizeOrigin), editor: raw.editor.map(normalizeOrigin) }
    const shared = origins.editor.filter((o) => origins.site.includes(o))
    if (shared.length && !input.allowSharedOrigin) {
      throw new ConfigError(`puck-remote: ${shared.join(', ')} is both a site and an editor origin. Theme scripts on the site could act with editor sessions; use a separate editor hostname (or set allowSharedOrigin).`)
    }
    if (!origins.editor.length) throw new ConfigError('puck-remote: origins.editor must list at least one origin')
    return origins
  }
  if (process.env.NODE_ENV === 'production' && !input.allowSharedOrigin) {
    throw new ConfigError(
      'puck-remote: `origins` is required in production, e.g. { site: ["https://www.example.com"], editor: ["https://admin.example.com"] }. ' +
        'Theme scripts run on the site origin; the editor (and its session cookies) must live on another one. Set allowSharedOrigin to opt out.',
    )
  }
  return null
}

function resolveSecurity(input: Pick<PuckRemoteConfig, 'security'>): SecurityPolicy {
  const s = input.security ?? {}
  return { ...DEFAULT_SECURITY, ...s, csp: { ...DEFAULT_SECURITY.csp, ...s.csp } } as SecurityPolicy
}

/** Just what request routing needs (proxy/middleware), without resolving the rest. */
export function resolveSurfaces(input: Pick<PuckRemoteConfig, 'routes' | 'origins' | 'allowSharedOrigin' | 'security'>): {
  routes: Routes
  origins: OriginsConfig | null
  security: SecurityPolicy
} {
  return { routes: { ...DEFAULT_ROUTES, ...input.routes }, origins: resolveOrigins(input as PuckRemoteConfig), security: resolveSecurity(input) }
}

export function resolveConfig(input: PuckRemoteConfig): HostConfig {
  const auth = requireAuthInProduction(input.auth)
  const origins = resolveOrigins(input)
  return {
    id: input.id ?? 'default',
    artifacts: input.artifacts,
    artifactPollMs: input.artifactPollMs ?? 2000,
    source: input.source,
    pages: input.pages,
    cache: input.cache ?? memoryCache(),
    renderer: input.renderer ?? null,
    auth,
    origins,
    security: resolveSecurity(input),
    // CSRF: mutations may come from the request's own origin, the editor origins, or this list.
    allowedOrigins: [...new Set([...(input.allowedOrigins ?? []), ...(origins?.editor ?? [])])],
    routes: { ...DEFAULT_ROUTES, ...input.routes },
    site: { name: 'Site', locale: 'en', ...input.site },
    isolate: {
      memoryLimitMb: 64,
      callTimeoutMs: 200,
      watchdogMs: 1000,
      maxInputBytes: 1024 * 1024,
      maxOutputBytes: 512 * 1024,
      ...input.isolate,
    },
    budget: { maxQueries: 20, maxResponseBytes: 2 * 1024 * 1024, maxWallMs: 3000, ...input.budget },
    http: {
      allowedOrigins: [],
      insecureDevOrigins: [],
      timeoutMs: 2000,
      maxResponseBytes: 512 * 1024,
      maxRedirects: 3,
      cacheTtlMs: 30_000,
      ...input.http,
    },
    secrets: input.secrets ?? {},
  }
}

// Light helpers apps use while writing their config (no isolate imports).
export { devAllowAll, sharedSecretAuth } from './auth.ts'
export { memoryCache } from './query/cache.ts'
