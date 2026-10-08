import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import type { ArtifactStore } from '@puck-remote/sdk/host'
import { checkBaseline } from './build.ts'

/** An ArtifactStore, or a directory path (shorthand for fsArtifactStore). */
export type ArtifactTarget = ArtifactStore | string

const toStore = (t: ArtifactTarget): ArtifactStore => (typeof t === 'string' ? fsArtifactStore({ dir: t }) : t)

export interface PublishOptions {
  distDir: string
  artifacts: ArtifactTarget
  quiet?: boolean
  /** Publish even if blocks changed without a version bump compared with the active artifact. */
  force?: boolean
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

/** Point the store at `version`. Rollback is just activating an older version. */
export async function activate(artifacts: ArtifactTarget, version: number): Promise<void> {
  await toStore(artifacts).writePointer(version)
}

/** Upload dist/ as the next version (never reusing a number, even after a rollback) and activate it. */
export async function publish(opts: PublishOptions): Promise<{ version: number }> {
  if (!existsSync(path.join(opts.distDir, 'manifest.json'))) throw new Error(`no manifest.json in ${opts.distDir}; run "puck-remote build" first`)
  const store = toStore(opts.artifacts)
  // Catch a forgotten --baseline: compare with what the site currently serves.
  const active = await store.readPointer()
  const activeManifest = active ? await store.readFile(active, 'manifest.json') : null
  if (activeManifest && !opts.force) {
    const next = JSON.parse(await readFile(path.join(opts.distDir, 'manifest.json'), 'utf8'))
    const problem = checkBaseline(next, JSON.parse(new TextDecoder().decode(activeManifest)))
    if (problem) throw new Error(`${problem} (compared with the active artifact v${active}; use --force to publish anyway)`)
  }
  const versions = await store.listVersions()
  const version = (versions.length ? Math.max(...versions) : 0) + 1
  const files: Record<string, Uint8Array> = {}
  for (const rel of await listFiles(opts.distDir)) files[rel] = new Uint8Array(await readFile(path.join(opts.distDir, rel)))
  await store.writeVersion(version, files)
  await store.writePointer(version)
  if (!opts.quiet) console.log(`[puck-remote publish] published v${version}`)
  return { version }
}
