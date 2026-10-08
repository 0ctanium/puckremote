/**
 * The host's stateful services for one resolved config: artifact store (manifest + isolate per
 * version), data source behind policy enforcement, HTTP client and query cache.
 */
import type { CacheStore } from '@puck-remote/sdk/host'
import { ArtifactLoader } from './artifact-loader.ts'
import type { HostConfig } from './config.ts'
import { workerPoolRenderer } from './runtime/worker-pool.ts'
import type { RenderRuntime } from './runtime/types.ts'
import { HttpSource } from './query/http-source.ts'
import { HostSource } from './query/host-source.ts'

export interface Host {
  config: HostConfig
  /** Loads, verifies and swaps the active artifact (one isolate per version). */
  store: ArtifactLoader<RenderRuntime>
  /** Operator data source behind host-side policy enforcement. */
  source: HostSource
  http: HttpSource
  cache: CacheStore
}

const KEY = Symbol.for('puck-remote.host')
type G = typeof globalThis & { [KEY]?: Promise<Host> }

export function createHost(config: HostConfig): Host {
  // Chosen here (not in config.ts) so the config entry never imports isolated-vm.
  const renderer = config.renderer ?? workerPoolRenderer()
  const { cache } = config
  // Content changes in the backend invalidate cached query results by tag.
  config.source.subscribe?.((tags) => void cache.invalidateTags(tags).catch(() => {}))
  return {
    config,
    store: new ArtifactLoader<RenderRuntime>({
      artifacts: config.artifacts,
      createRuntime: ({ version, bundle }) => renderer({ version, bundle, limits: config.isolate }),
      disposeGraceMs: 30_000,
    }),
    source: new HostSource(config.source),
    http: new HttpSource({ config: config.http, secrets: config.secrets }),
    cache,
  }
}
