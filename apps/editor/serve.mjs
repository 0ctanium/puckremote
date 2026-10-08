/**
 * Minimal static server for dist/ with the editor's security headers. Any static host works in
 * production as long as it sends the same headers (see the docs: "Editor app").
 *
 * PORT (default 3300), HOST (default 127.0.0.1), PUCK_REMOTE_ADMIN_ORIGINS.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { adminOrigins } from './origins.mjs'

const root = path.join(import.meta.dirname, 'dist')
const { importMapHash } = JSON.parse(await readFile(path.join(root, 'csp.json'), 'utf8'))
const admin = adminOrigins()
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

const csp = [
  "default-src 'self'",
  // The theme's browser bundle comes from the host's theme route (an admin origin).
  `script-src 'self' '${importMapHash}' ${admin.join(' ')}`,
  `style-src 'self' 'unsafe-inline' ${admin.join(' ')}`,
  'img-src * data: blob:',
  `font-src 'self' data: ${admin.join(' ')}`,
  "connect-src 'self'",
  // Puck renders its canvas in a same-origin iframe.
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  `frame-ancestors ${admin.join(' ')}`,
].join('; ')

const headers = {
  'content-security-policy': csp,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-store',
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  const file = path.join(root, rel)
  if (!file.startsWith(root + path.sep) || rel === 'csp.json') {
    res.writeHead(404, headers).end('Not found')
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404, headers).end('Not found')
  }
}).listen(Number(process.env.PORT ?? 3300), process.env.HOST ?? '127.0.0.1', function () {
  console.log(`[editor] http://${this.address().address}:${this.address().port} (embeddable by ${admin.join(', ')})`)
})
