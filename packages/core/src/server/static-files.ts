import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

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

/**
 * Serve a file from a published artifact, only if it is listed in that version's manifest and
 * its hash still matches. Guards against traversal, symlink escapes and tampering after publish.
 */
export async function readArtifactFile(artifactsDir: string, versionParam: string, rel: string): Promise<{ body: Buffer; type: string } | null> {
  const m = /^v([1-9]\d{0,6})$/.exec(versionParam)
  if (!m) return null
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.split('/').some((s) => s === '..' || s === '.' || s === '' || s.includes('\0'))) return null
  const root = await realpath(artifactsDir).catch(() => null)
  if (!root) return null
  const dir = path.join(root, `v${m[1]}`)
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => '{}'))
  const expected: string | undefined = manifest.files?.[rel]
  if (!expected) return null
  const real = await realpath(path.join(dir, rel)).catch(() => null)
  if (!real || !real.startsWith(dir + path.sep)) return null
  const body = await readFile(real)
  if (createHash('sha256').update(body).digest('hex') !== expected) {
    console.error(`[assets] hash mismatch for v${m[1]}/${rel}; refusing to serve`)
    return null
  }
  return { body, type: contentType(rel) }
}

export function fileResponse(f: { body: Buffer; type: string } | null): Response {
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
