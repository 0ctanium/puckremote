/**
 * The host's stateful services for one resolved config: the main theme's loader (manifest + one
 * isolate per theme version), preview runtimes, data source behind policy enforcement and HTTP client.
 */
import { ArtifactLoader } from './artifact-loader.ts'
import { ArtifactRuntimes } from './preview-runtimes.ts'
import type { HostConfig } from './config.ts'
import { workerPoolRenderer } from './runtime/worker-pool.ts'
import type { RenderRuntime } from './runtime/types.ts'
import { HttpSource } from './query/http-source.ts'
import { HostSource } from './query/host-source.ts'

export interface Host {
  config: HostConfig
  /** Loads and swaps the main theme (one isolate per theme version). */
  store: ArtifactLoader<RenderRuntime>
  /** Runtimes of other themes (previews, the editor on another theme), LRU-bounded. */
  previews: ArtifactRuntimes<RenderRuntime>
  /** Operator data source behind host-side policy enforcement. */
  source: HostSource
  http: HttpSource
}

export function createHost(config: HostConfig): Host {
  // Chosen here (not in config.ts) so the config entry never imports isolated-vm.
  const renderer = config.renderer ?? workerPoolRenderer()
  const createRuntime = ({ id, bundle }: { id: string; bundle: string }) => renderer({ id, bundle, limits: config.isolate })
  const store = new ArtifactLoader<RenderRuntime>({ artifacts: config.artifacts, createRuntime, disposeGraceMs: 30_000 })
  return {
    config,
    store,
    previews: new ArtifactRuntimes<RenderRuntime>({ live: store, createRuntime, ...config.previewRuntimes, disposeGraceMs: 30_000 }),
    source: new HostSource(config.source),
    http: new HttpSource({ config: config.http, secrets: config.secrets }),
  }
}
