import { createHash } from 'node:crypto'
import type { ArtifactStore } from '@puck-remote/sdk/host'
import path from 'node:path'
import { isArtifactId, shortId } from './artifact-loader.ts'

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

/** Files of an artifact that browsers may load: theme assets and the editor's browser bundle. */
export const isPublicFile = (rel: string) => rel === 'bundle.browser.js' || rel.startsWith('assets/')

/**
 * Serve a file from an artifact, only if it is public, listed in that artifact's manifest and its
 * hash still matches. Guards against traversal, symlink escapes and tampering after publish.
 */
export async function readArtifactFile(artifacts: ArtifactStore, id: string, rel: string): Promise<{ body: Uint8Array; type: string } | null> {
  if (!isArtifactId(id)) return null
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((s) => s === '..' || s === '.' || s === '' || s.includes('\0'))) return null
  if (!isPublicFile(rel)) return null
  const manifestBytes = await artifacts.readFile(id, 'manifest.json').catch(() => null)
  if (!manifestBytes) return null
  let expected: string | undefined
  try {
    expected = JSON.parse(new TextDecoder().decode(manifestBytes)).files?.[rel]
  } catch {
    return null
  }
  if (typeof expected !== 'string') return null
  const body = await artifacts.readFile(id, rel).catch(() => null)
  if (!body) return null
  if (createHash('sha256').update(body).digest('hex') !== expected) {
    console.error(`[assets] hash mismatch for ${shortId(id)}/${rel}; refusing to serve`)
    return null
  }
  return { body, type: contentType(rel) }
}

export function fileResponse(f: { body: Uint8Array; type: string } | null): Response {
  if (!f) return new Response('Not found', { status: 404 })
  const headers: Record<string, string> = {
    'content-type': f.type,
    'x-content-type-options': 'nosniff',
    'cache-control': 'public, max-age=31536000, immutable',
    'cross-origin-resource-policy': 'same-origin',
  }
  if (f.type === 'application/octet-stream') headers['content-disposition'] = 'attachment'
  return new Response(new Uint8Array(f.body), { headers })
}
