import { createHash } from 'node:crypto'
import type { ArtifactStore, Theme } from '@puck-remote/sdk/host'
import path from 'node:path'
import { themeVersion, VERSION_LENGTH } from '../shared/urls.ts'

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Files of a theme that browsers may load: theme assets, the editor's browser bundle and the islands bundle. */
export const isPublicFile = (rel: string) => rel === 'bundle.browser.js' || rel === 'bundle.islands.js' || rel.startsWith('assets/')

const safeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '' || s.includes('\0'))

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function manifestFiles(store: ArtifactStore, theme: string): Promise<Record<string, string> | null> {
  const bytes = await store.readFile(theme, 'manifest.json').catch(() => null)
  if (!bytes) return null
  try {
    const files = JSON.parse(new TextDecoder().decode(bytes)).files
    return files && typeof files === 'object' ? (files as Record<string, string>) : null
  } catch {
    return null
  }
}

export interface ThemeFile {
  body: Uint8Array
  type: string
  /** sha256 of the bytes served (the etag). */
  sha256: string
}

/**
 * Theme files by path and version (D-0518): `?v=` is the first 12 hex characters of the file's
 * sha256 in a manifest. The main theme first, then any theme whose current manifest lists that
 * path with that `v` (previews, the editor on another theme). Files are written in place, so the
 * bytes are hashed when served: only bytes matching the requested version are `immutable` (a CDN
 * never caches other bytes under a versioned URL); otherwise, and without a known `v`, the file is
 * served with `no-cache` and an etag.
 */
export class ThemeFiles {
  private manifests = new Map<string, Record<string, string> | null>()
  private index = new Map<string, { theme: string; sha: string }>()
  private version: string | null = null
  /** Number of index rebuilds (tests). */
  refreshes = 0

  constructor(private store: ArtifactStore) {}

  private async files(t: Theme) {
    if (!t.hash) return null
    // A theme version's manifest never changes: a new push has a new hash.
    const key = `${t.id}-${t.hash}`
    if (!this.manifests.has(key)) this.manifests.set(key, await manifestFiles(this.store, t.id))
    return this.manifests.get(key)!
  }

  /** Rebuild the `path + v → theme` index when the theme list changed. */
  private async themes(): Promise<Theme[]> {
    const { version, themes } = await this.store.readThemes()
    if (version !== this.version) {
      this.version = version
      this.refreshes++
      const index = new Map<string, { theme: string; sha: string }>()
      for (const t of themes)
        for (const [rel, sha] of Object.entries((await this.files(t)) ?? {}))
          if (isPublicFile(rel) && typeof sha === 'string') index.set(`${rel}\0${themeVersion(sha)}`, { theme: t.id, sha })
      this.index = index
    }
    return themes
  }

  private async read(theme: string, rel: string, expected: string | null): Promise<{ file: ThemeFile; immutable: boolean } | null> {
    const body = await this.store.readFile(theme, rel).catch(() => null)
    if (!body) return null
    const sha = sha256(body)
    return { file: { body, type: contentType(rel), sha256: sha }, immutable: expected !== null && sha === expected }
  }

  async get(rel: string, v: string | null): Promise<{ file: ThemeFile; immutable: boolean } | null> {
    if (!safeRel(rel) || !isPublicFile(rel)) return null
    const themes = await this.themes()
    const main = themes.find((t) => t.role === 'main') ?? null
    const mainSha = main ? (await this.files(main))?.[rel] : undefined
    if (v && /^[0-9a-f]+$/.test(v) && v.length === VERSION_LENGTH) {
      if (main && typeof mainSha === 'string' && themeVersion(mainSha) === v) return this.read(main.id, rel, mainSha)
      const hit = this.index.get(`${rel}\0${v}`)
      if (hit) {
        const f = await this.read(hit.theme, rel, hit.sha)
        if (f) return f
      }
    }
    if (!main || typeof mainSha !== 'string') return null
    const f = await this.read(main.id, rel, null)
    return f && { file: f.file, immutable: false }
  }
}

/** A theme file response: immutable for a matching `?v`, otherwise revalidated by etag. */
export function fileResponse(f: { file: ThemeFile; immutable: boolean } | null, request?: Request): Response {
  if (!f) return new Response('Not found', { status: 404 })
  const etag = `"${f.file.sha256}"`
  const headers: Record<string, string> = {
    'content-type': f.file.type,
    'x-content-type-options': 'nosniff',
    'cache-control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag,
    'cross-origin-resource-policy': 'same-origin',
  }
  if (f.file.type === 'application/octet-stream') headers['content-disposition'] = 'attachment'
  if (request?.headers.get('if-none-match')?.split(',').some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers })
  return new Response(new Uint8Array(f.file.body), { headers })
}
