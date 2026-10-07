import { createHash } from 'node:crypto'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { analyzeSpecs, manifestSchema, type Manifest } from './manifest-schema.ts'

export interface LoadedArtifact<R> {
  version: number
  dir: string
  manifest: Manifest
  /** The exact bytes that were hash-verified. Only ever compiled inside the isolate or served. */
  bundle: string
  runtime: R
  loadedAt: number
}

export interface Disposable {
  dispose(): void
}

export interface ArtifactStoreOptions<R> {
  artifactsDir: string
  createRuntime: (a: { version: number; manifest: Manifest; bundle: string }) => R | Promise<R>
  /** Delay before disposing the previous runtime, so in-flight requests can finish. */
  disposeGraceMs?: number
  log?: Pick<Console, 'info' | 'error'>
}

const currentSchema = z.strictObject({ version: z.number().int().positive() })

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

export class ArtifactError extends Error {}

/**
 * Loads a published artifact: pointer → manifest (zod) → every file hash → runtime (isolate).
 * Any failure leaves the previous good artifact serving.
 */
export class ArtifactStore<R extends Disposable> {
  private current: LoadedArtifact<R> | null = null
  private watcher: FSWatcher | null = null
  private pending: Promise<unknown> = Promise.resolve()
  private readonly log: Pick<Console, 'info' | 'error'>

  constructor(private readonly opts: ArtifactStoreOptions<R>) {
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
    const raw = await readFile(path.join(this.opts.artifactsDir, 'current.json'), 'utf8')
    return currentSchema.parse(JSON.parse(raw)).version
  }

  /** Validate a version completely without activating it. */
  async loadVersion(version: number): Promise<Omit<LoadedArtifact<R>, 'runtime'>> {
    const root = await realpath(this.opts.artifactsDir)
    const dir = path.join(root, `v${version}`)
    if (!existsSync(dir)) throw new ArtifactError(`v${version} does not exist`)
    const manifestRaw = await readFile(path.join(dir, 'manifest.json'), 'utf8')
    const parsed = manifestSchema.safeParse(JSON.parse(manifestRaw))
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
    for (const [rel, expected] of Object.entries(manifest.files)) {
      const abs = path.join(dir, rel)
      if (!abs.startsWith(dir + path.sep)) throw new ArtifactError(`v${version}: unsafe path ${rel}`)
      const real = await realpath(abs).catch(() => null)
      if (!real || !real.startsWith(dir + path.sep)) throw new ArtifactError(`v${version}: missing or escaping file ${rel}`)
      const buf = await readFile(real)
      if (sha256(buf) !== expected) throw new ArtifactError(`v${version}: hash mismatch for ${rel}`)
      if (rel === 'bundle.js') bundle = buf.toString('utf8')
    }
    if (bundle === null) throw new ArtifactError(`v${version}: bundle.js missing`)
    return { version, dir, manifest, bundle, loadedAt: Date.now() }
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

  watch(debounceMs = 100): void {
    if (this.watcher) return
    let t: NodeJS.Timeout | null = null
    this.watcher = watch(this.opts.artifactsDir, (_ev, file) => {
      if (file !== 'current.json') return
      if (t) clearTimeout(t)
      t = setTimeout(() => void this.reload(), debounceMs)
    })
    this.watcher.unref()
  }

  close(): void {
    this.watcher?.close()
    this.watcher = null
    this.current?.runtime.dispose()
    this.current = null
  }
}
