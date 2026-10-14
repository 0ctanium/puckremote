/**
 * `@puck-remote/payload/artifacts` — an ArtifactStore in Payload's database, so every instance of
 * the app shares the themes without another service (the collections come from the plugin):
 *
 *   puck-remote-theme-lists  { seq (unique), themes }      append-only revisions of the theme list
 *   puck-remote-theme-files  { theme, path, data, size }   a theme's current files (base64)
 *
 * The list's version is its seq ('0' before the first write). A write inserts seq + 1: two
 * concurrent writers cannot both insert it (unique index), so the loser gets ThemeConflictError.
 * The last 20 revisions are kept. Each file is one row, replaced by one update: a reader never
 * sees a partial file, but may see a mix of old and new files while a push is being written. No
 * change feed: the host polls readThemes().
 */
import { ThemeConflictError, type ArtifactStore, type Theme, type ThemeList } from '@puck-remote/sdk/host'
import type { Payload } from 'payload'
import { THEME_FILES, THEME_LISTS } from './collections.ts'

const KEEP_REVISIONS = 20

// The host pre-validates paths and ids; the store checks again (defense in depth, like artifacts-fs).
const isSafeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '')
const THEME_ID = /^[0-9a-f]{12}$/

function check(theme: string, path?: string) {
  if (!THEME_ID.test(theme)) throw new Error(`invalid theme id ${JSON.stringify(theme)}`)
  if (path !== undefined && !isSafeRel(path)) throw new Error(`unsafe path ${JSON.stringify(path)}`)
}

type PayloadGetter = Payload | (() => Payload | Promise<Payload>)

interface ListDoc {
  id: string | number
  seq: number
  themes: Theme[]
}

interface FileDoc {
  id: string | number
  path: string
  data: string
  size: number
}

export function payloadArtifactStore(opts: { payload: PayloadGetter }): ArtifactStore {
  const get = () => Promise.resolve(typeof opts.payload === 'function' ? opts.payload() : opts.payload)
  // The store is trusted host code: the collections deny every other access.
  const local = { overrideAccess: true, depth: 0 } as const

  const latest = async (payload: Payload): Promise<ListDoc | null> => {
    const r = await payload.find({ collection: THEME_LISTS as never, ...local, sort: '-seq', limit: 1, pagination: false })
    return (r.docs[0] as unknown as ListDoc | undefined) ?? null
  }

  const readThemes = async (): Promise<ThemeList> => {
    const doc = await latest(await get())
    return doc ? { version: String(doc.seq), themes: Array.isArray(doc.themes) ? doc.themes : [] } : { version: '0', themes: [] }
  }

  const fileDoc = async (payload: Payload, theme: string, path: string): Promise<FileDoc | null> => {
    const r = await payload.find({
      collection: THEME_FILES as never,
      ...local,
      where: { and: [{ theme: { equals: theme } }, { path: { equals: path } }] },
      limit: 1,
      pagination: false,
    })
    return (r.docs[0] as unknown as FileDoc | undefined) ?? null
  }

  const filesOf = async (payload: Payload, theme: string): Promise<FileDoc[]> => {
    const r = await payload.find({ collection: THEME_FILES as never, ...local, where: { theme: { equals: theme } }, pagination: false })
    return r.docs as unknown as FileDoc[]
  }

  const put = async (payload: Payload, theme: string, path: string, data: string, size: number) => {
    const existing = await fileDoc(payload, theme, path)
    if (existing) {
      await payload.update({ collection: THEME_FILES as never, id: existing.id, ...local, data: { data, size } as never })
      return
    }
    try {
      await payload.create({ collection: THEME_FILES as never, ...local, data: { theme, path, data, size } as never })
    } catch (e) {
      // Created concurrently (unique theme + path): replace it instead.
      const raced = await fileDoc(payload, theme, path)
      if (!raced) throw e
      await payload.update({ collection: THEME_FILES as never, id: raced.id, ...local, data: { data, size } as never })
    }
  }

  return {
    readThemes,

    async writeThemes(themes, { expect }) {
      const payload = await get()
      if ((await readThemes()).version !== expect) throw new ThemeConflictError()
      const seq = Number(expect) + 1
      try {
        await payload.create({ collection: THEME_LISTS as never, ...local, data: { seq, themes } as never })
      } catch (e) {
        // Another writer inserted this seq first.
        if ((await readThemes()).version !== expect) throw new ThemeConflictError()
        throw e
      }
      await payload.delete({ collection: THEME_LISTS as never, ...local, where: { seq: { less_than_equal: seq - KEEP_REVISIONS } } })
    },

    async readFile(theme, path) {
      if (!THEME_ID.test(theme) || !isSafeRel(path)) return null
      const doc = await fileDoc(await get(), theme, path)
      return doc ? new Uint8Array(Buffer.from(doc.data, 'base64')) : null
    },

    async writeFiles(theme, changes) {
      check(theme)
      for (const path of [...Object.keys(changes.put ?? {}), ...(changes.delete ?? [])]) check(theme, path)
      const payload = await get()
      for (const [path, bytes] of Object.entries(changes.put ?? {})) await put(payload, theme, path, Buffer.from(bytes).toString('base64'), bytes.byteLength)
      if (changes.delete?.length)
        await payload.delete({ collection: THEME_FILES as never, ...local, where: { and: [{ theme: { equals: theme } }, { path: { in: changes.delete } }] } })
    },

    async copyFiles(from, to) {
      check(from)
      check(to)
      const payload = await get()
      for (const f of await filesOf(payload, from)) await put(payload, to, f.path, f.data, f.size)
    },

    async deleteFiles(theme) {
      check(theme)
      await (await get()).delete({ collection: THEME_FILES as never, ...local, where: { theme: { equals: theme } } })
    },
  }
}
