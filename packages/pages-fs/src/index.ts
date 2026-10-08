/**
 * PageStore on the local filesystem. One directory per slug ('/' maps to '__'):
 *
 *   <dir>/<slug>/meta.json             draft and published pointers
 *   <dir>/<slug>/revisions/<n>.json    one file per revision (zero-padded counter = revision id)
 *
 * Writes go to a temp file then rename; a revision file is written before meta.json points to it.
 * Check-and-write is atomic within one process (per-slug lock). Single instance only: several
 * processes writing the same directory can lose updates. Use a database-backed store for clusters.
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PageMeta, PageRevision, PageStore, Revision, WriteResult } from '@puck-remote/sdk/host'

export interface FsPageStoreOptions {
  dir: string
  /** Revisions kept per page (oldest pruned first; the draft and published ones are always kept). Default 100. */
  maxRevisions?: number
}

const REVISION = /^\d{8}$/
const revisionId = (n: number) => String(n).padStart(8, '0')

export function fsPageStore(opts: FsPageStoreOptions): PageStore {
  const maxRevisions = opts.maxRevisions ?? 100
  if (!Number.isInteger(maxRevisions) || maxRevisions < 1) throw new Error('fsPageStore: maxRevisions must be a positive integer')

  // Slugs are validated by the host and never contain '_', so '__' is unambiguous.
  const pageDir = (slug: string) => path.join(opts.dir, slug.replaceAll('/', '__'))
  const metaFile = (slug: string) => path.join(pageDir(slug), 'meta.json')
  const revFile = (slug: string, r: Revision) => path.join(pageDir(slug), 'revisions', `${r}.json`)

  const locks = new Map<string, Promise<unknown>>()
  function locked<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(slug) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => {})
    locks.set(slug, tail)
    void tail.then(() => locks.get(slug) === tail && locks.delete(slug))
    return next
  }

  async function writeJson(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n')
    await rename(tmp, file)
  }

  async function readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  const readMeta = (slug: string) => readJson<PageMeta>(metaFile(slug))
  const readRevision = (slug: string, r: Revision) => (REVISION.test(r) ? readJson<PageRevision>(revFile(slug, r)) : Promise.resolve(null))

  async function revisionIds(slug: string): Promise<Revision[]> {
    const dir = path.join(pageDir(slug), 'revisions')
    if (!existsSync(dir)) return []
    return (await readdir(dir))
      .filter((f) => f.endsWith('.json') && REVISION.test(f.slice(0, -5)))
      .map((f) => f.slice(0, -5))
      .sort()
  }

  async function prune(slug: string, meta: PageMeta) {
    const ids = await revisionIds(slug)
    const keep = new Set([meta.draftRevision, meta.publishedRevision])
    let excess = ids.length - maxRevisions
    for (const id of ids) {
      if (excess <= 0) break
      if (keep.has(id)) continue
      await rm(revFile(slug, id), { force: true })
      excess--
    }
  }

  return {
    async list() {
      if (!existsSync(opts.dir)) return []
      const metas = await Promise.all((await readdir(opts.dir)).map((d) => readJson<PageMeta>(path.join(opts.dir, d, 'meta.json'))))
      return metas.filter((m): m is PageMeta => m !== null)
    },

    meta: readMeta,

    async getDraft(slug) {
      const meta = await readMeta(slug)
      return meta ? readRevision(slug, meta.draftRevision) : null
    },

    async getPublished(slug) {
      const meta = await readMeta(slug)
      return meta?.publishedRevision ? readRevision(slug, meta.publishedRevision) : null
    },

    async getRevision(slug, revision) {
      return (await readMeta(slug)) ? readRevision(slug, revision) : null
    },

    saveDraft(slug, page, { baseRevision, author }) {
      return locked(slug, async (): Promise<WriteResult> => {
        const meta = await readMeta(slug)
        if ((meta?.draftRevision ?? null) !== baseRevision) {
          return { ok: false, reason: 'conflict', meta }
        }
        const revision = revisionId(meta ? Number(meta.draftRevision) + 1 : 1)
        const now = new Date().toISOString()
        const rev: PageRevision = { revision, schemaVersion: page.schemaVersion, data: page.data, createdAt: now, ...(author ? { author } : {}) }
        await writeJson(revFile(slug, revision), rev)
        const next: PageMeta = {
          slug,
          draftRevision: revision,
          publishedRevision: meta?.publishedRevision ?? null,
          updatedAt: now,
          publishedAt: meta?.publishedAt ?? null,
        }
        await writeJson(metaFile(slug), next)
        await prune(slug, next)
        return { ok: true, meta: next }
      })
    },

    publish(slug, { revision }) {
      return locked(slug, async (): Promise<WriteResult> => {
        const meta = await readMeta(slug)
        if (!meta || meta.draftRevision !== revision) return { ok: false, reason: 'conflict', meta }
        const next: PageMeta = { ...meta, publishedRevision: revision, publishedAt: new Date().toISOString() }
        await writeJson(metaFile(slug), next)
        await prune(slug, next)
        return { ok: true, meta: next }
      })
    },

    unpublish(slug) {
      return locked(slug, async () => {
        const meta = await readMeta(slug)
        if (!meta || meta.publishedRevision === null) return
        await writeJson(metaFile(slug), { ...meta, publishedRevision: null, publishedAt: null })
      })
    },

    delete(slug) {
      return locked(slug, async () => {
        await rm(pageDir(slug), { recursive: true, force: true })
      })
    },

    async history(slug, { limit, before }) {
      if (!(await readMeta(slug))) return []
      const ids = (await revisionIds(slug)).reverse().filter((id) => before === undefined || id < before)
      const out = []
      for (const id of ids.slice(0, limit)) {
        const rev = await readRevision(slug, id)
        if (!rev) continue
        const { data: _data, ...info } = rev
        out.push(info)
      }
      return out
    },
  }
}
