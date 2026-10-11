/**
 * Runtimes for themes other than the main one (previews, the editor on another theme). Loaded like
 * the main theme (ArtifactLoader.loadArtifact), one isolate per theme version (`<id>-<hash>`); a
 * small LRU bounds memory, and idle runtimes are disposed.
 */
import { shortId, versionKey, type ArtifactLoader, type Disposable, type LoadedArtifact } from './artifact-loader.ts'
import type { Manifest } from './manifest-schema.ts'

interface Entry<R> {
  loaded: Promise<LoadedArtifact<R>>
  lastUsed: number
  timer: NodeJS.Timeout | null
}

export interface ArtifactRuntimesOptions<R extends Disposable> {
  live: ArtifactLoader<R>
  createRuntime: (a: { id: string; manifest: Manifest; bundle: string }) => R | Promise<R>
  max: number
  idleMs: number
  /** Delay before disposing an evicted runtime, so in-flight requests can finish. */
  disposeGraceMs?: number
  log?: Pick<Console, 'info' | 'error'>
}

export class ArtifactRuntimes<R extends Disposable> {
  private readonly entries = new Map<string, Entry<R>>()
  private readonly log: Pick<Console, 'info' | 'error'>

  constructor(private readonly opts: ArtifactRuntimesOptions<R>) {
    this.log = opts.log ?? console
  }

  /** The main theme's runtime when it is that version, otherwise a cached or freshly loaded one. Throws ArtifactError when invalid. */
  get(theme: { id: string; hash: string }): Promise<LoadedArtifact<R>> {
    const id = versionKey(theme.id, theme.hash)
    const live = this.opts.live.peek()
    if (live?.id === id) return Promise.resolve(live)
    let e = this.entries.get(id)
    if (!e) {
      const loaded = (async () => {
        const a = await this.opts.live.loadArtifact(theme.id)
        const runtime = await this.opts.createRuntime(a)
        this.log.info(`[themes] preview runtime for ${shortId(a.id)} (${a.manifest.artifactVersion})`)
        return { ...a, runtime }
      })()
      e = { loaded, lastUsed: 0, timer: null }
      this.entries.set(id, e)
      // A failed load is not cached: the next request retries.
      loaded.catch(() => {
        if (this.entries.get(id) === e) this.entries.delete(id)
      })
      this.evict(id)
    }
    this.touch(id, e)
    return e.loaded
  }

  /** Number of cached (non-live) runtimes. */
  get size(): number {
    return this.entries.size
  }

  private touch(id: string, e: Entry<R>) {
    e.lastUsed = Date.now()
    // Map order = recency order.
    this.entries.delete(id)
    this.entries.set(id, e)
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => this.drop(id, 0), this.opts.idleMs)
    e.timer.unref?.()
  }

  private evict(keep: string) {
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.opts.max) break
      if (id !== keep) this.drop(id, this.opts.disposeGraceMs ?? 0)
    }
  }

  private drop(id: string, graceMs: number) {
    const e = this.entries.get(id)
    if (!e) return
    this.entries.delete(id)
    if (e.timer) clearTimeout(e.timer)
    const dispose = () =>
      void e.loaded.then(
        (a) => {
          try {
            a.runtime.dispose()
          } catch {}
        },
        () => {},
      )
    if (graceMs) setTimeout(dispose, graceMs).unref?.()
    else dispose()
  }

  close(): void {
    for (const id of [...this.entries.keys()]) this.drop(id, 0)
  }
}
