import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import type { ArtifactId, ArtifactStore } from '@puck-remote/sdk/host'

/** An ArtifactStore, or a directory path (shorthand for fsArtifactStore). */
export type ArtifactTarget = ArtifactStore | string

const toStore = (t: ArtifactTarget): ArtifactStore => (typeof t === 'string' ? fsArtifactStore({ dir: t }) : t)

export interface PublishOptions {
  distDir: string
  artifacts: ArtifactTarget
  quiet?: boolean
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p, base)))
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

/** Point the store at an artifact. Rollback is just activating an older one. */
export async function activate(artifacts: ArtifactTarget, id: ArtifactId): Promise<void> {
  await toStore(artifacts).writePointer(id)
}

/**
 * Upload dist/ (code and pages, as they are in the theme repo) as an artifact and make it
 * current. Pages edited in the editor since the last `pull` are replaced, as in Shopify.
 */
export async function publish(opts: PublishOptions): Promise<{ id: ArtifactId }> {
  if (!existsSync(path.join(opts.distDir, 'manifest.json'))) throw new Error(`no manifest.json in ${opts.distDir}; run "puck-remote build" first`)
  const store = toStore(opts.artifacts)
  const files: Record<string, Uint8Array> = {}
  for (const rel of await listFiles(opts.distDir)) files[rel] = new Uint8Array(await readFile(path.join(opts.distDir, rel)))
  const id = await store.writeArtifact(files)
  await store.writePointer(id)
  if (!opts.quiet) console.log(`[puck-remote publish] published ${id}`)
  return { id }
}

export interface PullOptions {
  /** The theme repo: pages are written to <cwd>/pages/<slug>.json. */
  cwd: string
  artifacts: ArtifactTarget
  /** Default: the current artifact. */
  artifact?: ArtifactId
  quiet?: boolean
}

const PAGE_FILE = /^pages\/((?:[a-z0-9][a-z0-9-]{0,63}\/){0,4}[a-z0-9][a-z0-9-]{0,63})\.json$/

/** Download an artifact's pages into the theme repo (like `shopify theme pull`), so editor changes ship with the next publish. */
export async function pull(opts: PullOptions): Promise<{ id: ArtifactId; pages: string[] }> {
  const store = toStore(opts.artifacts)
  const id = opts.artifact ?? (await store.readPointer())
  if (!id) throw new Error('nothing published yet')
  const manifestBytes = await store.readFile(id, 'manifest.json')
  if (!manifestBytes) throw new Error(`artifact ${id} not found`)
  const files = (JSON.parse(new TextDecoder().decode(manifestBytes)).files ?? {}) as Record<string, string>
  const pages = Object.keys(files).filter((f) => PAGE_FILE.test(f)).sort()
  for (const file of pages) {
    const bytes = await store.readFile(id, file)
    if (!bytes) throw new Error(`artifact ${id}: ${file} is missing`)
    const target = path.join(opts.cwd, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  if (!opts.quiet) console.log(`[puck-remote pull] ${pages.length} pages from ${id}`)
  return { id, pages }
}
