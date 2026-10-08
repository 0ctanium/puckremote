import { createHash } from 'node:crypto'
import type { ArtifactStore } from '@puck-remote/sdk/host'
import { z } from 'zod'
import { analyzeSpecs, manifestSchema, type Manifest } from './manifest-schema.ts'

export interface LoadedArtifact<R> {
  version: number
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
  createRuntime: (a: { version: number; manifest: Manifest; bundle: string }) => R | Promise<R>
  /** Delay before disposing the previous runtime, so in-flight requests can finish. */
  disposeGraceMs?: number
  log?: Pick<Console, 'info' | 'error'>
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })

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

  async readPointer(): Promise<number> {
    const v = await this.opts.artifacts.readPointer()
    if (!Number.isInteger(v) || (v as number) < 1) throw new ArtifactError('no valid active artifact version')
    return v as number
  }

  /** Validate a version completely without activating it. */
  async loadVersion(version: number): Promise<Omit<LoadedArtifact<R>, 'runtime'>> {
    const manifestRaw = await this.opts.artifacts.readFile(version, 'manifest.json')
    if (!manifestRaw) throw new ArtifactError(`v${version} does not exist`)
    let json: unknown
    try {
      json = JSON.parse(decoder.decode(manifestRaw))
    } catch {
      throw new ArtifactError(`v${version}: manifest.json is not valid JSON`)
    }
    const parsed = manifestSchema.safeParse(json)
    if (!parsed.success) throw new ArtifactError(`v${version}: invalid manifest: ${z.prettifyError(parsed.error)}`)
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
      const buf = await this.opts.artifacts.readFile(version, rel)
      if (!buf) throw new ArtifactError(`v${version}: missing file ${rel}`)
      if (sha256(buf) !== expected) throw new ArtifactError(`v${version}: hash mismatch for ${rel}`)
      if (rel === 'bundle.js') bundle = decoder.decode(buf)
    }
    if (bundle === null) throw new ArtifactError(`v${version}: bundle.js missing`)
    return { version, manifest, bundle, loadedAt: Date.now() }
  }

  /**
   * Re-read current.json and swap if it points somewhere new. Serialized: concurrent calls queue.
   * Never throws; returns the outcome. On failure the previous artifact keeps serving.
   */
  reload(opts: { force?: boolean } = {}): Promise<{ ok: true; version: number; changed: boolean } | { ok: false; error: string }> {
    const run = async () => {
      try {
        const version = await this.readPointer()
        if (!opts.force && this.current?.version === version) return { ok: true as const, version, changed: false }
        const loaded = await this.loadVersion(version)
        const runtime = await this.opts.createRuntime(loaded)
        const previous = this.current
        this.current = { ...loaded, runtime }
        this.log.info(`[artifacts] serving v${version} (${loaded.manifest.artifactVersion})`)
        if (previous && previous.runtime !== runtime) {
          const dispose = () => {
            try {
              previous.runtime.dispose()
            } catch {}
          }
          if (this.opts.disposeGraceMs) setTimeout(dispose, this.opts.disposeGraceMs).unref()
          else dispose()
        }
        return { ok: true as const, version, changed: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.log.error(`[artifacts] !!! REJECTED artifact update, still serving ${this.current ? `v${this.current.version}` : 'nothing'}: ${error}`)
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
