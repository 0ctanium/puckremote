import type { AnyDataSource, ArtifactStore } from '@puck-remote/sdk/host'
import type { RendererFactory } from './runtime/types.ts'
import { DEFAULT_SECURITY, normalizeOrigin, type SecurityPolicy } from './surface.ts'

export interface SecretDef {
  value: string
  /** Origins this secret may be sent to. Anything else is rejected. */
  origins: string[]
}

/** Fully resolved configuration used by the core. */
export interface HostConfig {
  id: string
  routes: Routes
  /** Theme artifacts: code and pages (trusted host plugin chosen by the app). */
  artifacts: ArtifactStore
  /** How often to poll the artifact pointer when the store has no change feed. */
  artifactPollMs: number
  source: AnyDataSource
  /** Where theme code runs. null → the host's default (see host.ts). */
  renderer: RendererFactory | null
  /** CSP and related policy for public pages (see surface.ts securityHeaders). */
  security: SecurityPolicy
  /**
   * Where the editor runs: the host's admin pages (which embed the editor and own the session)
   * and the static editor app (credential-free). null = editor not configured.
   */
  origins: EditorOrigins | null
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
  }
  secrets: Record<string, SecretDef>
}

export interface EditorOrigins {
  /** Origins of the host pages that embed the editor (<PuckEditorFrame>). */
  admin: string[]
  /** Origin of the static editor app loaded in the iframe. */
  editor: string
}

export interface Routes {
  /** Prefix of the catch-all theme route (assets and the editor's browser bundle). */
  theme: string
  /** Prefix of the app's editor route, when the app serves the editor itself (only on origins.editor). */
  editor: string
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] }

/** What an app provides. Everything except paths and plugins has a default. */
type Plugins = 'artifacts' | 'source' | 'secrets' | 'renderer' | 'security' | 'origins'

/** What an app provides. Everything except the storage plugins has a default. */
export interface PuckRemoteConfig extends DeepPartial<Omit<HostConfig, Plugins>> {
  /** Distinguishes runtimes if one process hosts several sites. Default 'default'. */
  id?: string
  artifacts: ArtifactStore
  source: AnyDataSource
  /** Where theme code runs: workerPoolRenderer() (default) or inProcessRenderer(). */
  renderer?: RendererFactory | null
  /** CSP and related headers for public pages; see DEFAULT_SECURITY. */
  security?: Partial<Omit<SecurityPolicy, 'csp'>> & { csp?: Partial<SecurityPolicy['csp']> }
  secrets?: Record<string, SecretDef>
  /** Admin and editor origins, e.g. { admin: ['https://admin.example.com'], editor: 'https://editor.example.net' }. */
  origins?: EditorOrigins | null
}

export class ConfigError extends Error {}

/** Typed identity: use in the app's puck-remote.config.ts. Safe to import from proxy/edge code. */
export function defineConfig<C extends PuckRemoteConfig>(config: C): C {
  return config
}

export const DEFAULT_ROUTES: Routes = { theme: '/theme', editor: '/editor' }

function resolveSecurity(input: Pick<PuckRemoteConfig, 'security'>): SecurityPolicy {
  const s = input.security ?? {}
  return { ...DEFAULT_SECURITY, ...s, csp: { ...DEFAULT_SECURITY.csp, ...s.csp } } as SecurityPolicy
}

export function resolveOrigins(input: PuckRemoteConfig['origins']): EditorOrigins | null {
  if (!input) return null
  const admin = input.admin.map(normalizeOrigin)
  const editor = normalizeOrigin(input.editor)
  if (!admin.length) throw new ConfigError('puck-remote: origins.admin must list at least one origin')
  if (admin.includes(editor)) {
    throw new ConfigError(`puck-remote: ${editor} is both an admin and the editor origin. The editor runs theme code; it must live on its own origin, without the admin's session.`)
  }
  return { admin, editor }
}

export function resolveConfig(input: PuckRemoteConfig): HostConfig {
  return {
    origins: resolveOrigins(input.origins),
    id: input.id ?? 'default',
    artifacts: input.artifacts,
    artifactPollMs: input.artifactPollMs ?? 2000,
    source: input.source,
    renderer: input.renderer ?? null,
    security: resolveSecurity(input),
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
      ...input.http,
    },
    secrets: input.secrets ?? {},
  }
}
