import { createHash } from 'node:crypto'
import type { ArtifactId, ArtifactStore } from '@puck-remote/sdk/host'
import { z } from 'zod'
import { analyzeSpecs, manifestSchema, type Manifest } from './manifest-schema.ts'

export interface LoadedArtifact<R> {
  id: ArtifactId
  manifest: Manifest
  /** The exact bytes that were hash-verified. Only ever compiled inside the isolate or served. */
  bundle: string
  runtime: R
  loadedAt: number
}

export interface Disposable {
  dispose(): void
}

export interface ArtifactLoaderOptions<R> {
  /** Where versions and the active pointer live (fs, S3, …). */
  artifacts: ArtifactStore
  createRuntime: (a: { id: ArtifactId; manifest: Manifest; bundle: string }) => R | Promise<R>
  /** Delay before disposing the previous runtime, so in-flight requests can finish. */
  disposeGraceMs?: number
  log?: Pick<Console, 'info' | 'error'>
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })

/** Ids are opaque to the core, but they end up in URLs and logs: keep them to a safe charset. */
export const ARTIFACT_ID = /^[A-Za-z0-9._-]{1,128}$/
export const isArtifactId = (id: unknown): id is ArtifactId => typeof id === 'string' && ARTIFACT_ID.test(id) && id !== '.' && id !== '..'

/** Short form for logs and UI. */
export const shortId = (id: ArtifactId) => id.slice(0, 12)

export class ArtifactError extends Error {}

/**
 * Loads a published artifact from an ArtifactStore: pointer → manifest (zod) → every file hash →
 * runtime (isolate). Any failure leaves the previous good artifact serving.
 */
export class ArtifactLoader<R extends Disposable> {
  private current: LoadedArtifact<R> | null = null
  private stopWatching: (() => void) | null = null
  private pending: Promise<unknown> = Promise.resolve()
  private readonly log: Pick<Console, 'info' | 'error'>

  constructor(private readonly opts: ArtifactLoaderOptions<R>) {
    this.log = opts.log ?? console
  }

  get(): LoadedArtifact<R> {
    if (!this.current) throw new ArtifactError('no artifact loaded')
    return this.current
  }

  peek(): LoadedArtifact<R> | null {
    return this.current
  }

  async readPointer(): Promise<ArtifactId> {
    const id = await this.opts.artifacts.readPointer()
    if (!isArtifactId(id)) throw new ArtifactError('no valid current artifact')
    return id
  }

  /** Validate an artifact completely without activating it. */
  async loadArtifact(id: ArtifactId): Promise<Omit<LoadedArtifact<R>, 'runtime'>> {
    if (!isArtifactId(id)) throw new ArtifactError(`invalid artifact id`)
    const version = shortId(id)
    const manifestRaw = await this.opts.artifacts.readFile(id, 'manifest.json')
    if (!manifestRaw) throw new ArtifactError(`${version} does not exist`)
    let json: unknown
    try {
      json = JSON.parse(decoder.decode(manifestRaw))
    } catch {
      throw new ArtifactError(`${version}: manifest.json is not valid JSON`)
    }
    const parsed = manifestSchema.safeParse(json)
    if (!parsed.success) throw new ArtifactError(`${version}: invalid manifest: ${z.prettifyError(parsed.error)}`)
    const manifest = parsed.data

    // Recompute derived analysis instead of trusting the CLI.
    for (const [name, b] of [...Object.entries(manifest.blocks), ...(manifest.root ? [['root', manifest.root] as const] : [])]) {
      const a = analyzeSpecs(b.data)
      b.propRefs = a.propRefs
      b.usesRequestParams = a.usesRequestParams
      void name
    }

    let bundle: string | null = null
    // Paths were validated by the manifest schema; the store adds its own containment checks.
    for (const [rel, expected] of Object.entries(manifest.files)) {
      const buf = await this.opts.artifacts.readFile(id, rel)
      if (!buf) throw new ArtifactError(`${version}: missing file ${rel}`)
      if (sha256(buf) !== expected) throw new ArtifactError(`${version}: hash mismatch for ${rel}`)
      if (rel === 'bundle.js') bundle = decoder.decode(buf)
    }
    if (bundle === null) throw new ArtifactError(`${version}: bundle.js missing`)
    return { id, manifest, bundle, loadedAt: Date.now() }
  }

  /**
   * Re-read the pointer and swap if it points somewhere new. Serialized: concurrent calls queue.
   * Never throws; returns the outcome. On failure the previous artifact keeps serving.
   */
  reload(opts: { force?: boolean } = {}): Promise<{ ok: true; id: ArtifactId; changed: boolean } | { ok: false; error: string }> {
    const run = async () => {
      try {
        const id = await this.readPointer()
        if (!opts.force && this.current?.id === id) return { ok: true as const, id, changed: false }
        const loaded = await this.loadArtifact(id)
        const runtime = await this.opts.createRuntime(loaded)
        const previous = this.current
        this.current = { ...loaded, runtime }
        this.log.info(`[artifacts] serving ${shortId(id)} (${loaded.manifest.artifactVersion})`)
        if (previous && previous.runtime !== runtime) {
          const dispose = () => {
            try {
              previous.runtime.dispose()
            } catch {}
          }
          if (this.opts.disposeGraceMs) setTimeout(dispose, this.opts.disposeGraceMs).unref()
          else dispose()
        }
        return { ok: true as const, id, changed: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.log.error(`[artifacts] !!! REJECTED artifact update, still serving ${this.current ? shortId(this.current.id) : 'nothing'}: ${error}`)
        return { ok: false as const, error }
      }
    }
    const p = this.pending.then(run, run)
    this.pending = p
    return p
  }

  /** Follow pointer changes: the store's change feed if it has one, otherwise polling. */
  watch(pollMs = 2000): void {
    if (this.stopWatching) return
    const { artifacts } = this.opts
    if (artifacts.watch) {
      this.stopWatching = artifacts.watch(() => void this.reload())
      return
    }
    const timer = setInterval(() => void this.reload(), pollMs)
    timer.unref()
    this.stopWatching = () => clearInterval(timer)
  }

  close(): void {
    this.stopWatching?.()
    this.stopWatching = null
    this.current?.runtime.dispose()
    this.current = null
  }
}
