/**
 * The host's stateful services for one resolved config: artifact store (manifest + isolate per
 * artifact), data source behind policy enforcement and HTTP client.
 */
import { ArtifactLoader } from './artifact-loader.ts'
import type { HostConfig } from './config.ts'
import { workerPoolRenderer } from './runtime/worker-pool.ts'
import type { RenderRuntime } from './runtime/types.ts'
import { HttpSource } from './query/http-source.ts'
import { HostSource } from './query/host-source.ts'

export interface Host {
  config: HostConfig
  /** Loads, verifies and swaps the current artifact (one isolate per artifact). */
  store: ArtifactLoader<RenderRuntime>
  /** Operator data source behind host-side policy enforcement. */
  source: HostSource
  http: HttpSource
}

export function createHost(config: HostConfig): Host {
  // Chosen here (not in config.ts) so the config entry never imports isolated-vm.
  const renderer = config.renderer ?? workerPoolRenderer()
  return {
    config,
    store: new ArtifactLoader<RenderRuntime>({
      artifacts: config.artifacts,
      createRuntime: ({ id, bundle }) => renderer({ id, bundle, limits: config.isolate }),
      disposeGraceMs: 30_000,
    }),
    source: new HostSource(config.source),
    http: new HttpSource({ config: config.http, secrets: config.secrets }),
  }
}
