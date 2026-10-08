/**
 * ArtifactStore on the local filesystem:
 *
 *   <dir>/current.json   {"version": N}          (written via temp file + rename: atomic)
 *   <dir>/v<N>/…          immutable version       (written to a temp dir, then renamed)
 *
 * Suits single-server deployments. Serverless / multi-instance setups need a shared store (S3…).
 */
import { existsSync, watch as fsWatch } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArtifactStore } from '@puck-remote/sdk/host'

const isSafeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '')

const assertVersion = (v: number) => {
  if (!Number.isInteger(v) || v < 1) throw new Error(`invalid artifact version ${v}`)
}

export function fsArtifactStore(opts: { dir: string }): ArtifactStore & { dir: string } {
  const dir = path.resolve(opts.dir)
  const pointerFile = path.join(dir, 'current.json')

  return {
    dir,

    async readPointer() {
      if (!existsSync(pointerFile)) return null
      const v = JSON.parse(await readFile(pointerFile, 'utf8'))?.version
      return Number.isInteger(v) && v > 0 ? v : null
    },

    async writePointer(version) {
      assertVersion(version)
      if (!existsSync(path.join(dir, `v${version}`))) throw new Error(`artifact v${version} does not exist in ${dir}`)
      const tmp = path.join(dir, `.current.json.${process.pid}.${Date.now()}.tmp`)
      await writeFile(tmp, JSON.stringify({ version }) + '\n')
      await rename(tmp, pointerFile)
    },

    async listVersions() {
      if (!existsSync(dir)) return []
      return (await readdir(dir))
        .map((d) => /^v([1-9]\d*)$/.exec(d)?.[1])
        .filter((v): v is string => !!v)
        .map(Number)
        .sort((a, b) => a - b)
    },

    async readFile(version, rel) {
      assertVersion(version)
      if (!isSafeRel(rel)) return null
      const root = await realpath(path.join(dir, `v${version}`)).catch(() => null)
      if (!root) return null
      // Resolve symlinks and refuse anything that escapes the version directory.
      const real = await realpath(path.join(root, rel)).catch(() => null)
      if (!real || !real.startsWith(root + path.sep)) return null
      return new Uint8Array(await readFile(real))
    },

    async writeVersion(version, files) {
      assertVersion(version)
      const target = path.join(dir, `v${version}`)
      if (existsSync(target)) throw new Error(`artifact v${version} already exists`)
      await mkdir(dir, { recursive: true })
      // Write into a temp dir and rename, so a half-written version is never visible.
      const tmp = path.join(dir, `.v${version}.${process.pid}.${Date.now()}.tmp`)
      await rm(tmp, { recursive: true, force: true })
      for (const [rel, bytes] of Object.entries(files)) {
        if (!isSafeRel(rel)) throw new Error(`unsafe artifact path ${rel}`)
        const f = path.join(tmp, rel)
        await mkdir(path.dirname(f), { recursive: true })
        await writeFile(f, bytes)
      }
      await rename(tmp, target)
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
