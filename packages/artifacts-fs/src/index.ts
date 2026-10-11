/**
 * ArtifactStore on the local filesystem:
 *
 *   <dir>/themes.json           {"themes": [...]}        (temp file + rename: atomic)
 *   <dir>/.themes.lock                                    (held while the list changes; stale after 10 s)
 *   <dir>/themes/<id>/<path>    a theme's current files  (each written to a temp file, then renamed)
 *
 * The theme list's version is the sha256 of themes.json ('none' before the first write). Files are
 * replaced in place, one atomic rename per file, like a Shopify theme's assets: a reader never sees
 * a partial file, but may see a mix of old and new files while a push is being written.
 *
 * Suits single-server deployments. Serverless / multi-instance setups need a shared store (S3…).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, watch as fsWatch } from 'node:fs'
import { copyFile, link, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ThemeConflictError, type ArtifactStore, type Theme, type ThemeList } from '@puck-remote/sdk/host'

const isSafeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '')

const THEME_ID = /^[0-9a-f]{12}$/

const assertTheme = (id: string) => {
  if (!THEME_ID.test(id)) throw new Error(`invalid theme id ${JSON.stringify(id)}`)
}

const LOCK_STALE_MS = 10_000

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

let tmpCounter = 0
const tmpName = (file: string) => `${file}.${process.pid}.${Date.now()}.${tmpCounter++}.tmp`

async function listFiles(dir: string, base = dir): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p, base)))
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

export function fsArtifactStore(opts: { dir: string }): ArtifactStore & { dir: string } {
  const dir = path.resolve(opts.dir)
  const themesFile = path.join(dir, 'themes.json')
  const lockFile = path.join(dir, '.themes.lock')
  const themeDir = (id: string) => path.join(dir, 'themes', id)
  const NO_THEMES = 'none'

  const readThemes = async (): Promise<ThemeList> => {
    const raw = await readFile(themesFile).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (!raw) return { version: NO_THEMES, themes: [] }
    const themes = JSON.parse(raw.toString('utf8'))?.themes
    return { version: sha256(raw), themes: Array.isArray(themes) ? (themes as Theme[]) : [] }
  }

  /** Serialize list changes across processes (compare-and-swap needs read + write under one lock). */
  const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    await mkdir(dir, { recursive: true })
    for (;;) {
      try {
        const h = await open(lockFile, 'wx')
        await h.close()
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        // A crashed writer leaves the lock behind: take it over once it is stale.
        const age = await stat(lockFile).then((s) => Date.now() - s.mtimeMs, () => 0)
        if (age > LOCK_STALE_MS) await rm(lockFile, { force: true })
        else await new Promise((r) => setTimeout(r, 20))
      }
    }
    try {
      return await fn()
    } finally {
      await rm(lockFile, { force: true })
    }
  }

  return {
    dir,

    readThemes,

    async writeThemes(themes, opts) {
      for (const t of themes) assertTheme(t.id)
      await withLock(async () => {
        if ((await readThemes()).version !== opts.expect) throw new ThemeConflictError()
        const tmp = tmpName(themesFile)
        await writeFile(tmp, JSON.stringify({ themes }, null, 2) + '\n')
        await rename(tmp, themesFile)
      })
    },

    async readFile(theme, rel) {
      if (!THEME_ID.test(theme) || !isSafeRel(rel)) return null
      const root = await realpath(themeDir(theme)).catch(() => null)
      if (!root) return null
      // Resolve symlinks and refuse anything that escapes the theme directory.
      const real = await realpath(path.join(root, rel)).catch(() => null)
      if (!real || !real.startsWith(root + path.sep)) return null
      return new Uint8Array(await readFile(real))
    },

    async writeFiles(theme, changes) {
      assertTheme(theme)
      const put = changes.put ?? {}
      const del = changes.delete ?? []
      for (const rel of [...Object.keys(put), ...del]) if (!isSafeRel(rel)) throw new Error(`unsafe theme path ${rel}`)
      const root = themeDir(theme)
      for (const [rel, bytes] of Object.entries(put)) {
        const file = path.join(root, rel)
        await mkdir(path.dirname(file), { recursive: true })
        // Write next to the target and rename: a reader sees the old file or the new one.
        const tmp = tmpName(file)
        await writeFile(tmp, bytes)
        await rename(tmp, file)
      }
      for (const rel of del) await rm(path.join(root, rel), { force: true })
    },

    async copyFiles(from, to) {
      assertTheme(from)
      assertTheme(to)
      const src = themeDir(from)
      const dst = themeDir(to)
      for (const rel of await listFiles(src)) {
        const target = path.join(dst, rel)
        await mkdir(path.dirname(target), { recursive: true })
        await rm(target, { force: true })
        // Hard links share the bytes (no copy of large assets); writes replace files by rename, so
        // changing one theme never changes the other. Fall back to a copy across devices.
        await link(path.join(src, rel), target).catch(() => copyFile(path.join(src, rel), target))
      }
    },

    async deleteFiles(theme) {
      assertTheme(theme)
      await rm(themeDir(theme), { recursive: true, force: true })
    },

    watch(onChange) {
      // A fresh install has no directory yet: create it so the first theme is seen.
      mkdirSync(dir, { recursive: true })
      let t: NodeJS.Timeout | null = null
      const w = fsWatch(dir, (_ev, file) => {
        if (file !== 'themes.json') return
        if (t) clearTimeout(t)
        t = setTimeout(onChange, 100)
        t.unref()
      })
      w.unref()
      return () => {
        w.close()
        if (t) clearTimeout(t)
      }
    },
  }
}
