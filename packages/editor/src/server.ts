/**
 * Serves the static editor (dist/static) from any Node server: a Request → Response handler.
 * Used by the `puck-remote-editor` bin, by your own process, and by @puck-remote/next's editor
 * route. The editor holds no credentials: responses never set cookies, and only the admin
 * origins may frame it.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_ELEMENT_ID } from './protocol.ts'

export interface EditorHandlerOptions {
  /** Admin origins allowed to embed the editor (frame-ancestors, and the bridge's allowed parents). */
  adminOrigins: string[]
  /** Path prefix the handler is mounted under (stripped from request paths). Default ''. */
  basePath?: string
}

interface StaticFiles {
  files: Map<string, Uint8Array>
  importMapHash: string
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/** dist/static next to the built module (dist/server.js), or from sources (src/server.ts). */
function staticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const dir of [path.join(here, 'static'), path.join(here, '..', 'dist', 'static')]) {
    if (existsSync(path.join(dir, 'index.html'))) return dir
  }
  throw new Error('@puck-remote/editor: the static editor is missing (dist/static); build the package')
}

let loaded: Promise<StaticFiles> | null = null
function loadStatic(): Promise<StaticFiles> {
  return (loaded ??= (async () => {
    const dir = staticDir()
    const files = new Map<string, Uint8Array>()
    const walk = async (rel: string) => {
      for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(r)
        else if (e.isFile() && Object.hasOwn(TYPES, path.extname(e.name))) files.set(r, new Uint8Array(await readFile(path.join(dir, r))))
      }
    }
    await walk('')
    const { importMapHash } = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as { importMapHash: string }
    return { files, importMapHash }
  })())
}

/** Response headers of every editor response. */
export function editorHeaders(adminOrigins: string[], importMapHash: string): Record<string, string> {
  const admin = adminOrigins.join(' ')
  const csp = [
    "default-src 'self'",
    // The theme's browser bundle comes from the host's theme route (an admin origin).
    `script-src 'self' '${importMapHash}' ${admin}`,
    `style-src 'self' 'unsafe-inline' ${admin}`,
    'img-src * data: blob:',
    `font-src 'self' data: ${admin}`,
    "connect-src 'self'",
    // Puck renders its canvas in a same-origin iframe.
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${admin}`,
  ].join('; ')
  return {
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
  }
}

export function createEditorHandler(opts: EditorHandlerOptions): (request: Request) => Promise<Response> {
  const adminOrigins = opts.adminOrigins.map((o) => new URL(o).origin)
  if (!adminOrigins.length) throw new Error('@puck-remote/editor: adminOrigins must list at least one origin')
  const base = (opts.basePath ?? '').replace(/\/+$/, '')
  // A JSON data block: never executed, so the CSP needs no hash for it. `<` is escaped so the
  // content can't close the script element.
  const configBlock = `<script type="application/json" id="${CONFIG_ELEMENT_ID}">${JSON.stringify({ adminOrigins }).replace(/</g, '\\u003c')}</script>`
  let page: Uint8Array | null = null

  return async function handleEditor(request) {
    const { files, importMapHash } = await loadStatic()
    const headers = editorHeaders(adminOrigins, importMapHash)
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { ...headers, allow: 'GET, HEAD' } })
    let pathname = new URL(request.url).pathname
    if (base && (pathname === base || pathname.startsWith(base + '/'))) pathname = pathname.slice(base.length)
    const rel = pathname === '' || pathname === '/' || pathname === '/index.html' ? 'index.html' : pathname.slice(1)
    const body = rel === 'index.html' ? (page ??= new TextEncoder().encode(new TextDecoder().decode(files.get('index.html')!).replace('<!--puck-remote-editor-config-->', configBlock))) : files.get(rel)
    if (!body) return new Response('Not found', { status: 404, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } })
    const out = new Headers(headers)
    out.set('content-type', TYPES[path.extname(rel)])
    // Asset URLs carry a content hash (?v=); the page itself is never cached.
    out.set('cache-control', rel === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable')
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers: out })
  }
}
