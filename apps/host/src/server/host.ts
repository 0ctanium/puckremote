/**
 * Process-wide host singleton (survives Next dev HMR via globalThis). Holds the artifact store
 * (manifest + isolate per version), the data sources and the query cache.
 */
import { ArtifactStore } from './artifact-loader.ts'
import { defaultHostConfig, type HostConfig } from './config.ts'
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

const KEY = Symbol.for('poc.host')
type G = typeof globalThis & { [KEY]?: Promise<Host> }

export function createHost(config: HostConfig = defaultHostConfig()): Host {
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

export function getHost(): Promise<Host> {
  const g = globalThis as G
  g[KEY] ??= (async () => {
    const host = createHost()
    const r = await host.store.reload()
    if (!r.ok) console.error('[host] no artifact could be loaded at startup:', r.error)
    host.store.watch()
    return host
  })()
  return g[KEY]
}
