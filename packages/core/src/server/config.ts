import type { AnyDataSource, PageStore } from '@poc/sdk/host'

export interface SecretDef {
  value: string
  /** Origins this secret may be sent to. Anything else is rejected. */
  origins: string[]
}

/** Fully resolved configuration used by the core. */
export interface HostConfig {
  id: string
  artifactsDir: string
  routes: Routes
  /** Pluggable, trusted host plugins chosen by the app. */
  source: AnyDataSource
  pages: PageStore
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
export interface PocConfigInput extends DeepPartial<Omit<HostConfig, 'artifactsDir' | 'source' | 'pages' | 'secrets'>> {
  /** Distinguishes runtimes if one process hosts several sites. Default 'default'. */
  id?: string
  artifactsDir: string
  source: AnyDataSource
  pages: PageStore
  secrets?: Record<string, SecretDef>
}

/** Typed identity: use in the app's poc.config.ts. Safe to import from proxy/edge code. */
export function definePocConfig<C extends PocConfigInput>(config: C): C {
  return config
}

export const DEFAULT_ROUTES: Routes = { api: '/api', theme: '/theme', editor: '/editor' }

export function resolveConfig(input: PocConfigInput): HostConfig {
  return {
    id: input.id ?? 'default',
    artifactsDir: input.artifactsDir,
    source: input.source,
    pages: input.pages,
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
