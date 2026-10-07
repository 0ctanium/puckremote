/**
 * The host's stateful services for one resolved config: artifact store (manifest + isolate per
 * version), data source behind policy enforcement, HTTP client and query cache.
 */
import { ArtifactStore } from './artifact-loader.ts'
import type { HostConfig } from './config.ts'
import { IsolateRunner } from './isolate-runner.ts'
import { QueryCache } from './query/cache.ts'
import { HttpSource } from './query/http-source.ts'
import { HostSource } from './query/host-source.ts'

export interface Host {
  config: HostConfig
  store: ArtifactStore<IsolateRunner>
  /** Operator data source behind host-side policy enforcement. */
  source: HostSource
  http: HttpSource
  cache: QueryCache
}

const KEY = Symbol.for('puck-remote.host')
type G = typeof globalThis & { [KEY]?: Promise<Host> }

export function createHost(config: HostConfig): Host {
  const cache = new QueryCache()
  // Content changes in the backend invalidate cached query results by tag.
  config.source.subscribe?.((tags) => tags.forEach((t) => cache.invalidate(t)))
  return {
    config,
    store: new ArtifactStore<IsolateRunner>({
      artifactsDir: config.artifactsDir,
      createRuntime: ({ bundle }) => new IsolateRunner(bundle, config.isolate),
      disposeGraceMs: 30_000,
    }),
    source: new HostSource(config.source),
    http: new HttpSource({ config: config.http, secrets: config.secrets }),
    cache,
  }
}
