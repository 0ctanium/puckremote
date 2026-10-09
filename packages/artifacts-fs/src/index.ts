/**
 * ArtifactStore on the local filesystem:
 *
 *   <dir>/current.json   {"id": "<id>"}            (written via temp file + rename: atomic)
 *   <dir>/<id>/…          immutable artifact        (written to a temp dir, then renamed)
 *
 * The id is a content hash, like a git commit: sha256 over the sorted lines
 * "<path>\0<sha256(file)>\n" of every file. Writing identical content returns the existing id.
 *
 * Suits single-server deployments. Serverless / multi-instance setups need a shared store (S3…).
 */
import { createHash } from 'node:crypto'
import { existsSync, watch as fsWatch } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArtifactId, ArtifactStore } from '@puck-remote/sdk/host'

const isSafeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '')

const ID = /^[0-9a-f]{64}$/

const assertId = (id: string) => {
  if (!ID.test(id)) throw new Error(`invalid artifact id ${id}`)
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

/** The id artifacts-fs gives a set of files. */
export function artifactHash(files: Record<string, Uint8Array>): ArtifactId {
  const lines = Object.keys(files)
    .sort()
    .map((rel) => `${rel}\0${sha256(files[rel])}\n`)
  return sha256(lines.join(''))
}

export function fsArtifactStore(opts: { dir: string }): ArtifactStore & { dir: string } {
  const dir = path.resolve(opts.dir)
  const pointerFile = path.join(dir, 'current.json')

  return {
    dir,

    async readPointer() {
      if (!existsSync(pointerFile)) return null
      const id = JSON.parse(await readFile(pointerFile, 'utf8'))?.id
      return typeof id === 'string' && ID.test(id) ? id : null
    },

    async writePointer(id) {
      assertId(id)
      if (!existsSync(path.join(dir, id))) throw new Error(`artifact ${id} does not exist in ${dir}`)
      const tmp = path.join(dir, `.current.json.${process.pid}.${Date.now()}.tmp`)
      await writeFile(tmp, JSON.stringify({ id }) + '\n')
      await rename(tmp, pointerFile)
    },

    async list() {
      if (!existsSync(dir)) return []
      return (await readdir(dir)).filter((d) => ID.test(d)).sort()
    },

    async readFile(id, rel) {
      if (!ID.test(id) || !isSafeRel(rel)) return null
      const root = await realpath(path.join(dir, id)).catch(() => null)
      if (!root) return null
      // Resolve symlinks and refuse anything that escapes the artifact directory.
      const real = await realpath(path.join(root, rel)).catch(() => null)
      if (!real || !real.startsWith(root + path.sep)) return null
      return new Uint8Array(await readFile(real))
    },

    async writeArtifact(files) {
      for (const rel of Object.keys(files)) if (!isSafeRel(rel)) throw new Error(`unsafe artifact path ${rel}`)
      const id = artifactHash(files)
      const target = path.join(dir, id)
      if (existsSync(target)) return id
      await mkdir(dir, { recursive: true })
      // Write into a temp dir and rename, so a half-written artifact is never visible.
      const tmp = path.join(dir, `.${id}.${process.pid}.${Date.now()}.tmp`)
      await rm(tmp, { recursive: true, force: true })
      for (const [rel, bytes] of Object.entries(files)) {
        const f = path.join(tmp, rel)
        await mkdir(path.dirname(f), { recursive: true })
        await writeFile(f, bytes)
      }
      try {
        await rename(tmp, target)
      } catch (e) {
        // Another writer stored the same content first.
        await rm(tmp, { recursive: true, force: true })
        if (!existsSync(target)) throw e
      }
      return id
    },

    watch(onChange) {
      if (!existsSync(dir)) return () => {}
      let t: NodeJS.Timeout | null = null
      const w = fsWatch(dir, (_ev, file) => {
        if (file !== 'current.json') return
        if (t) clearTimeout(t)
        t = setTimeout(onChange, 100)
      })
      w.unref()
      return () => w.close()
    },
  }
}
