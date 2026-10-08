/**
 * The host's stateful services for one resolved config: artifact store (manifest + isolate per
 * version), data source behind policy enforcement, HTTP client and query cache.
 */
import type { CacheStore } from '@puck-remote/sdk/host'
import { ArtifactLoader } from './artifact-loader.ts'
import type { HostConfig } from './config.ts'
import { IsolateRunner } from './isolate-runner.ts'
import { HttpSource } from './query/http-source.ts'
import { HostSource } from './query/host-source.ts'

export interface Host {
  config: HostConfig
  /** Loads, verifies and swaps the active artifact (one isolate per version). */
  store: ArtifactLoader<IsolateRunner>
  /** Operator data source behind host-side policy enforcement. */
  source: HostSource
  http: HttpSource
  cache: CacheStore
}

const KEY = Symbol.for('puck-remote.host')
type G = typeof globalThis & { [KEY]?: Promise<Host> }

export function createHost(config: HostConfig): Host {
  const { cache } = config
  // Content changes in the backend invalidate cached query results by tag.
  config.source.subscribe?.((tags) => void cache.invalidateTags(tags).catch(() => {}))
  return {
    config,
    store: new ArtifactLoader<IsolateRunner>({
      artifacts: config.artifacts,
      createRuntime: ({ bundle }) => new IsolateRunner(bundle, config.isolate),
      disposeGraceMs: 30_000,
    }),
    source: new HostSource(config.source),
    http: new HttpSource({ config: config.http, secrets: config.secrets }),
    cache,
  }
}
