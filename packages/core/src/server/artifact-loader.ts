import { createHash } from 'node:crypto'
import type { ArtifactStore } from '@puck-remote/sdk/host'
import { mainTheme } from './main-theme.ts'
import { z } from 'zod'
import { analyzeSpecs, manifestSchema, type Manifest } from './manifest-schema.ts'

/** A theme version loaded in memory: its manifest, its isolate bundle and the runtime built from it. */
export interface LoadedArtifact<R> {
  /** `<theme id>-<hash>`: identifies this version of the theme (runtimes, caches, logs). */
  id: string
  theme: string
  /** sha256 of the manifest.json that was loaded. */
  hash: string
  manifest: Manifest
  /** The bundle bytes, only ever compiled inside the isolate. */
  bundle: string
  runtime: R
  loadedAt: number
}

export interface Disposable {
  dispose(): void
}

export interface ArtifactLoaderOptions<R> {
  /** Where the themes and their files live (fs, S3, …). The loader serves the main theme. */
  artifacts: ArtifactStore
  createRuntime: (a: { id: string; manifest: Manifest; bundle: string }) => R | Promise<R>
  /** Delay before disposing the previous runtime, so in-flight requests can finish. */
  disposeGraceMs?: number
  log?: Pick<Console, 'info' | 'error'>
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })

/** The key of a theme version (`<theme id>-<manifest hash>`). */
export const versionKey = (theme: string, hash: string) => `${theme}-${hash}`

/** Short form for logs and UI: the theme id and the first 12 characters of its hash. */
export const shortId = (key: string) => key.slice(0, 25)

export class ArtifactError extends Error {}

/** Parse and validate a manifest (zod), recomputing derived analysis instead of trusting the CLI. */
export function parseManifest(label: string, bytes: Uint8Array): Manifest {
  let json: unknown
  try {
    json = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new ArtifactError(`${label}: manifest.json is not valid JSON`)
  }
  const parsed = manifestSchema.safeParse(json)
  if (!parsed.success) throw new ArtifactError(`${label}: invalid manifest: ${z.prettifyError(parsed.error)}`)
  const manifest = parsed.data
  for (const b of [...Object.values(manifest.blocks), ...(manifest.root ? [manifest.root] : [])]) {
    const a = analyzeSpecs(b.data)
    b.propRefs = a.propRefs
    b.usesRequestParams = a.usesRequestParams
  }
  return manifest
}

/**
 * Loads a theme's current version: manifest.json (zod) and bundle.js. Files are not re-hashed:
 * the artifacts API verified them when they were uploaded, and a theme's files are written in
 * place, so a load during a push may see the previous manifest (the next change notice reloads).
 */
export async function loadThemeFiles(store: ArtifactStore, theme: string): Promise<{ id: string; theme: string; hash: string; manifest: Manifest; bundle: string }> {
  const manifestBytes = await store.readFile(theme, 'manifest.json')
  if (!manifestBytes) throw new ArtifactError(`theme ${theme} has no files`)
  const hash = sha256(manifestBytes)
  const label = `theme ${theme}`
  const manifest = parseManifest(label, manifestBytes)
  if (!Object.hasOwn(manifest.files, 'bundle.js')) throw new ArtifactError(`${label}: bundle.js missing`)
  const bundleBytes = await store.readFile(theme, 'bundle.js')
  if (!bundleBytes) throw new ArtifactError(`${label}: bundle.js missing`)
  return { id: versionKey(theme, hash), theme, hash, manifest, bundle: decoder.decode(bundleBytes) }
}

/**
 * Serves the main theme: theme list → manifest (zod) + bundle → runtime (isolate). Any failure
 * leaves the previous good version serving.
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
    if (!this.current) throw new ArtifactError('no theme loaded')
    return this.current
  }

  peek(): LoadedArtifact<R> | null {
    return this.current
  }

  /** The main theme's id and hash. Throws when there is none or it has no files. */
  async readMain(): Promise<{ theme: string; hash: string }> {
    const main = await mainTheme(this.opts.artifacts)
    if (!main) throw new ArtifactError('no main theme')
    if (!main.hash) throw new ArtifactError(`main theme ${main.id} has no files yet`)
    return { theme: main.id, hash: main.hash }
  }

  /** Load a theme's current version without activating it. */
  async loadArtifact(theme: string): Promise<Omit<LoadedArtifact<R>, 'runtime'>> {
    return { ...(await loadThemeFiles(this.opts.artifacts, theme)), loadedAt: Date.now() }
  }

  /**
   * Re-read the main theme and swap if it changed. Serialized: concurrent calls queue.
   * Never throws; returns the outcome. On failure the previous version keeps serving.
   */
  reload(opts: { force?: boolean } = {}): Promise<{ ok: true; id: string; changed: boolean } | { ok: false; error: string }> {
    const run = async () => {
      try {
        const main = await this.readMain()
        const key = versionKey(main.theme, main.hash)
        if (!opts.force && this.current?.id === key) return { ok: true as const, id: key, changed: false }
        const loaded = await this.loadArtifact(main.theme)
        if (!opts.force && this.current?.id === loaded.id) return { ok: true as const, id: loaded.id, changed: false }
        const runtime = await this.opts.createRuntime(loaded)
        const previous = this.current
        this.current = { ...loaded, runtime }
        this.log.info(`[themes] serving ${shortId(loaded.id)} (${loaded.manifest.artifactVersion})`)
        if (previous && previous.runtime !== runtime) {
          const dispose = () => {
            try {
              previous.runtime.dispose()
            } catch {}
          }
          if (this.opts.disposeGraceMs) setTimeout(dispose, this.opts.disposeGraceMs).unref()
          else dispose()
        }
        return { ok: true as const, id: loaded.id, changed: true }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.log.error(`[themes] !!! REJECTED theme update, still serving ${this.current ? shortId(this.current.id) : 'nothing'}: ${error}`)
        return { ok: false as const, error }
      }
    }
    const p = this.pending.then(run, run)
    this.pending = p
    return p
  }

  /** Follow the main theme: the store's change feed if it has one, otherwise polling. */
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
