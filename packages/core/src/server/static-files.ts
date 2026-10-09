import { createHash } from 'node:crypto'
import type { ArtifactStore } from '@puck-remote/sdk/host'
import path from 'node:path'
import { isArtifactId, shortId } from './artifact-loader.ts'
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

/** Files of an artifact that browsers may load: theme assets, the editor's browser bundle and the islands bundle. */
export const isPublicFile = (rel: string) => rel === 'bundle.browser.js' || rel === 'bundle.islands.js' || rel.startsWith('assets/')

const safeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '' || s.includes('\0'))

async function manifestFiles(artifacts: ArtifactStore, id: string): Promise<Record<string, string> | null> {
  const bytes = await artifacts.readFile(id, 'manifest.json').catch(() => null)
  if (!bytes) return null
  try {
    const files = JSON.parse(new TextDecoder().decode(bytes)).files
    return files && typeof files === 'object' ? (files as Record<string, string>) : null
  } catch {
    return null
  }
}

async function readVerified(artifacts: ArtifactStore, id: string, rel: string, expected: string): Promise<ThemeFile | null> {
  const body = await artifacts.readFile(id, rel).catch(() => null)
  if (!body) return null
  if (createHash('sha256').update(body).digest('hex') !== expected) {
    console.error(`[assets] hash mismatch for ${shortId(id)}/${rel}; refusing to serve`)
    return null
  }
  return { body, type: contentType(rel), sha256: expected }
}

export interface ThemeFile {
  body: Uint8Array
  type: string
  sha256: string
}

/**
 * Serve a file from an artifact, only if it is public, listed in that artifact's manifest and its
 * hash still matches. Guards against traversal, symlink escapes and tampering after publish.
 */
export async function readArtifactFile(artifacts: ArtifactStore, id: string, rel: string): Promise<ThemeFile | null> {
  if (!isArtifactId(id) || !safeRel(rel) || !isPublicFile(rel)) return null
  const expected = (await manifestFiles(artifacts, id))?.[rel]
  return typeof expected === 'string' ? readVerified(artifacts, id, rel, expected) : null
}

/** How often (at most) a request for an unknown `v` may rescan the store. */
export const INDEX_REFRESH_MS = 10_000

/**
 * Theme files by path and version (D-0264, D-0266): the current artifact first, then any stored
 * artifact holding that exact version, through a lazily built `path + v → id` index. Without a
 * known `v`, the current artifact's file (not immutable).
 */
export class ThemeFiles {
  private manifests = new Map<string, Record<string, string> | null>()
  private index = new Map<string, string>()
  private indexed = new Set<string>()
  private lastRefresh = -Infinity
  private pointer: string | null = null
  /** Number of store scans (tests). */
  refreshes = 0

  constructor(private artifacts: ArtifactStore, private now: () => number = () => performance.now()) {}

  private async files(id: string) {
    // Artifacts are immutable: a manifest never changes once read.
    if (!this.manifests.has(id)) this.manifests.set(id, await manifestFiles(this.artifacts, id))
    return this.manifests.get(id)!
  }

  private async refresh() {
    this.lastRefresh = this.now()
    this.refreshes++
    for (const id of await this.artifacts.list()) {
      if (this.indexed.has(id) || !isArtifactId(id)) continue
      this.indexed.add(id)
      for (const [rel, sha] of Object.entries((await this.files(id)) ?? {}))
        if (isPublicFile(rel) && typeof sha === 'string') this.index.set(`${rel}\0${themeVersion(sha)}`, id)
    }
  }

  async get(rel: string, v: string | null): Promise<{ file: ThemeFile; immutable: boolean } | null> {
    if (!safeRel(rel) || !isPublicFile(rel)) return null
    const current = await this.artifacts.readPointer()
    if (current !== this.pointer) {
      // A new artifact was published: let the next miss rescan right away.
      this.pointer = current
      this.lastRefresh = -Infinity
    }
    const currentFiles = current && isArtifactId(current) ? await this.files(current) : null
    const currentSha = currentFiles?.[rel]
    if (v && /^[0-9a-f]+$/.test(v) && v.length === VERSION_LENGTH) {
      if (current && typeof currentSha === 'string' && themeVersion(currentSha) === v) {
        const file = await readVerified(this.artifacts, current, rel, currentSha)
        return file && { file, immutable: true }
      }
      const key = `${rel}\0${v}`
      if (!this.index.has(key) && this.now() - this.lastRefresh >= INDEX_REFRESH_MS) await this.refresh()
      const id = this.index.get(key)
      const sha = id ? (await this.files(id))?.[rel] : undefined
      if (id && typeof sha === 'string') {
        const file = await readVerified(this.artifacts, id, rel, sha)
        if (file) return { file, immutable: true }
      }
    }
    if (!current || typeof currentSha !== 'string') return null
    const file = await readVerified(this.artifacts, current, rel, currentSha)
    return file && { file, immutable: false }
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
