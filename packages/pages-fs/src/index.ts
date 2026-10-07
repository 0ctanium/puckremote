/** PageStore on the local filesystem: one JSON file per slug, atomic writes (temp + rename). */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PageStore } from '@poc/sdk/host'

export function fsPageStore(opts: { dir: string }): PageStore {
  // Slugs are validated by the host; '/' maps to '__' so nested slugs stay one file.
  const file = (slug: string) => path.join(opts.dir, `${slug.replaceAll('/', '__')}.json`)
  return {
    async get(slug) {
      const f = file(slug)
      return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : null
    },
    async put(slug, data) {
      await mkdir(opts.dir, { recursive: true })
      const f = file(slug)
      const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, JSON.stringify(data, null, 2) + '\n')
      await rename(tmp, f)
    },
    async list() {
      if (!existsSync(opts.dir)) return []
      return (await readdir(opts.dir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5).replaceAll('__', '/'))
    },
  }
}
