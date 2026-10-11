/**
 * Themes, like Shopify's: named sets of files with a role (`main` = live, `unpublished`,
 * `development`) and a `hash`, the sha256 of their manifest.json (their version). The store keeps
 * the list (readThemes / writeThemes with a version check) and each theme's files; every rule
 * lives here: ids, names, one main theme, single-theme mode, expiry, and which files a theme may
 * hold (the write path).
 */
import { randomBytes } from 'node:crypto'
import { THEME_ROLES, type ArtifactStore, type Theme, type ThemeRole } from '@puck-remote/sdk/host'
import { ArtifactError, parseManifest, sha256 } from './artifact-loader.ts'
import type { HostConfig } from './config.ts'

export const THEME_ID = /^[0-9a-f]{12}$/
export const isThemeId = (id: unknown): id is string => typeof id === 'string' && THEME_ID.test(id)

export const MAX_THEME_NAME = 50

/** A refused theme operation, with the HTTP status the artifacts API answers. */
export class ThemeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'ThemeError'
  }
}

export const SINGLE_THEME = 'this site has a single theme (themes.multiple is false)'

/** A valid theme name (trimmed), or a ThemeError. */
export function themeName(name: unknown): string {
  if (typeof name !== 'string') throw new ThemeError('theme name must be a string', 400)
  const n = name.trim()
  if (!n || n.length > MAX_THEME_NAME) throw new ThemeError(`theme name must be 1 to ${MAX_THEME_NAME} characters`, 400)
  if (/[\u0000-\u001f\u007f]/.test(n)) throw new ThemeError('theme name must not contain control characters', 400)
  return n
}

const isRole = (r: unknown): r is ThemeRole => THEME_ROLES.includes(r as ThemeRole)

const isSafeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '')

/** Concurrent writes on other themes are retried; a real conflict (`expect`) is not. */
const MAX_ATTEMPTS = 5

const noFiles = (t: Theme) => new ThemeError(`theme ${t.id} has no files yet`, 409)

export interface ThemeOps {
  list(): Promise<Theme[]>
  get(id: string): Promise<Theme | null>
  main(): Promise<Theme | null>
  /** A new theme without files (`hash: null`); push files to it with `writeFiles`. */
  create(input: { name: string; role: ThemeRole }): Promise<Theme>
  rename(id: string, name: string): Promise<Theme>
  /**
   * Write files into a theme: `files` holds the new manifest.json and the files that changed (all
   * of them for a full push). Every file the manifest lists must be in `files` with that sha256,
   * or unchanged in the theme's current manifest; files no longer listed are removed. With
   * `expect`, the theme's hash must still be that (409 otherwise).
   */
  writeFiles(id: string, files: Record<string, Uint8Array>, opts?: { expect?: string | null }): Promise<Theme>
  publish(id: string): Promise<Theme>
  delete(id: string): Promise<void>
  duplicate(id: string, opts?: { name?: string }): Promise<Theme>
  /** Delete development themes not updated for `themes.devExpiryDays`. Returns their ids. */
  prune(): Promise<string[]>
}

export function themeOps(
  config: Pick<HostConfig, 'artifacts' | 'themes'>,
  opts: { now?: () => Date; onMainChange?: () => void | Promise<void> } = {},
): ThemeOps {
  const store: ArtifactStore = config.artifacts
  const now = () => (opts.now ?? (() => new Date()))().toISOString()
  const single = !config.themes.multiple

  const mainVersion = (themes: Theme[]) => {
    // A main theme without files serves nothing yet: only versions with files count.
    const m = themes.find((t) => t.role === 'main')
    return m?.hash ? `${m.id}-${m.hash}` : null
  }

  /** Read, change, write with a version check; retried when another write got in between. */
  async function mutate<T>(change: (themes: Theme[]) => { themes: Theme[]; result: T }): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const { version, themes } = await store.readThemes()
      const next = change(themes.map((t) => ({ ...t })))
      if (next.themes.filter((t) => t.role === 'main').length > 1) throw new ThemeError('only one theme can be main', 409)
      try {
        await store.writeThemes(next.themes, { expect: version })
      } catch (e) {
        if ((e as { code?: string })?.code === 'THEME_CONFLICT' && attempt < MAX_ATTEMPTS) continue
        throw e
      }
      if (mainVersion(themes) !== mainVersion(next.themes)) await opts.onMainChange?.()
      return next.result
    }
  }

  const find = (themes: Theme[], id: string) => {
    const t = isThemeId(id) ? themes.find((x) => x.id === id) : undefined
    if (!t) throw new ThemeError(`theme ${id} not found`, 404)
    return t
  }

  const newId = (themes: Theme[]) => {
    for (;;) {
      const id = randomBytes(6).toString('hex')
      if (!themes.some((t) => t.id === id)) return id
    }
  }

  /** The `files` map of a theme's current manifest ({} without files). */
  async function currentFiles(theme: Theme): Promise<Record<string, string>> {
    if (!theme.hash) return {}
    const bytes = await store.readFile(theme.id, 'manifest.json')
    if (!bytes) return {}
    const files = JSON.parse(new TextDecoder().decode(bytes))?.files
    return files && typeof files === 'object' ? files : {}
  }

  return {
    async list() {
      return (await store.readThemes()).themes
    },
    async get(id) {
      if (!isThemeId(id)) return null
      return (await store.readThemes()).themes.find((t) => t.id === id) ?? null
    },
    async main() {
      return (await store.readThemes()).themes.find((t) => t.role === 'main') ?? null
    },
    async create(input) {
      const name = themeName(input.name)
      if (!isRole(input.role)) throw new ThemeError(`invalid theme role ${String(input.role)}`, 400)
      return mutate((themes) => {
        if (single && (themes.length || input.role !== 'main')) throw new ThemeError(SINGLE_THEME, 409)
        if (input.role === 'main' && themes.some((t) => t.role === 'main'))
          throw new ThemeError('a main theme already exists: create an unpublished theme and publish it', 409)
        const at = now()
        const theme: Theme = { id: newId(themes), name, role: input.role, hash: null, createdAt: at, updatedAt: at }
        return { themes: [...themes, theme], result: theme }
      })
    },
    async rename(id, name) {
      const n = themeName(name)
      return mutate((themes) => {
        const t = find(themes, id)
        t.name = n
        t.updatedAt = now()
        return { themes, result: t }
      })
    },
    async writeFiles(id, files, o = {}) {
      const theme = find((await store.readThemes()).themes, id)
      if (o.expect !== undefined && theme.hash !== o.expect)
        throw new ThemeError(`theme ${id} changed (expected ${o.expect?.slice(0, 12) ?? 'no files'}, found ${theme.hash?.slice(0, 12) ?? 'no files'})`, 409)
      const manifestBytes = files['manifest.json']
      if (!manifestBytes) throw new ThemeError('upload: manifest.json is missing', 400)
      let listed: Record<string, string>
      try {
        listed = parseManifest('upload', manifestBytes).files
      } catch (e) {
        if (e instanceof ArtifactError) throw new ThemeError(e.message, 400)
        throw e
      }
      if (!Object.hasOwn(listed, 'bundle.js')) throw new ThemeError('upload: bundle.js missing', 400)
      for (const rel of Object.keys(files)) {
        if (!isSafeRel(rel)) throw new ThemeError(`upload: unsafe path ${rel}`, 400)
        if (rel !== 'manifest.json' && !Object.hasOwn(listed, rel)) throw new ThemeError(`upload: ${rel} is not listed in manifest.files`, 400)
      }
      // Files not uploaded must already be in the theme, unchanged (its manifest was verified when written).
      const current = await currentFiles(theme)
      for (const [rel, expected] of Object.entries(listed)) {
        if (Object.hasOwn(files, rel)) {
          if (sha256(files[rel]) !== expected) throw new ThemeError(`upload: hash mismatch for ${rel}`, 400)
        } else if (current[rel] !== expected) throw new ThemeError(`upload: ${rel} is neither uploaded nor unchanged in theme ${id}`, 400)
      }
      const { 'manifest.json': manifest, ...changed } = files
      const removed = Object.keys(current).filter((rel) => !Object.hasOwn(listed, rel))
      // Changed files first, the manifest last, then removals: a reader never sees a manifest
      // listing a file that is not written yet.
      await store.writeFiles(id, { put: changed })
      await store.writeFiles(id, { put: { 'manifest.json': manifest } })
      if (removed.length) await store.writeFiles(id, { delete: removed })
      const hash = sha256(manifest)
      return mutate((themes) => {
        const t = find(themes, id)
        t.hash = hash
        t.updatedAt = now()
        return { themes, result: t }
      })
    },
    async publish(id) {
      return mutate((themes) => {
        const t = find(themes, id)
        if (t.role === 'main') return { themes, result: t }
        if (single) throw new ThemeError(SINGLE_THEME, 409)
        if (!t.hash) throw noFiles(t)
        for (const other of themes) if (other.role === 'main') other.role = 'unpublished'
        t.role = 'main'
        t.updatedAt = now()
        return { themes, result: t }
      })
    },
    async delete(id) {
      await mutate((themes) => {
        const t = find(themes, id)
        if (t.role === 'main') throw new ThemeError('the main theme cannot be deleted', 400)
        return { themes: themes.filter((x) => x !== t), result: undefined }
      })
      await store.deleteFiles(id)
    },
    async duplicate(id, o = {}) {
      const name = o.name === undefined ? undefined : themeName(o.name)
      const copy = await mutate((themes) => {
        if (single) throw new ThemeError(SINGLE_THEME, 409)
        const source = find(themes, id)
        const at = now()
        const theme: Theme = {
          id: newId(themes),
          name: name ?? `Copy of ${source.name}`.slice(0, MAX_THEME_NAME).trim(),
          role: 'unpublished',
          // Set once the files are copied.
          hash: null,
          createdAt: at,
          updatedAt: at,
        }
        return { themes: [...themes, theme], result: { theme, sourceHash: source.hash } }
      })
      if (!copy.sourceHash) return copy.theme
      await store.copyFiles(id, copy.theme.id)
      return mutate((themes) => {
        const t = find(themes, copy.theme.id)
        t.hash = copy.sourceHash
        return { themes, result: t }
      })
    },
    async prune() {
      const limit = Date.parse(now()) - config.themes.devExpiryDays * 86_400_000
      const expired = (themes: Theme[]) => themes.filter((t) => t.role === 'development' && Date.parse(t.updatedAt) < limit)
      if (!expired((await store.readThemes()).themes).length) return []
      const gone = await mutate((themes) => {
        const ids = new Set(expired(themes).map((t) => t.id))
        return { themes: themes.filter((t) => !ids.has(t.id)), result: [...ids] }
      })
      for (const id of gone) await store.deleteFiles(id)
      return gone
    },
  }
}
