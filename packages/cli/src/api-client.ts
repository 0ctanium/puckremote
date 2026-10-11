import type { Theme, ThemeRole } from '@puck-remote/sdk/host'
import type { CliConfig } from './config.ts'

/**
 * Client of the host's artifacts API (`routes.api`, mounted by the app with its own `authorize`).
 * The CLI adds no auth of its own: `headers` and `fetch` (from puck-remote.cli.ts) shape every
 * request the way the host expects.
 */

export interface ApiTarget {
  /** Base URL of the API, e.g. https://admin.example.com/api/themes */
  url: string
  /** Added to every request (a function is called per request). */
  headers?: CliConfig['headers']
  /** Sends each request (headers already added). Default: global fetch. */
  fetch?: CliConfig['fetch']
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** A theme as the API returns it, with a preview link for non-main themes when the host has previews. */
export interface ThemeResult {
  theme: Theme
  previewUrl?: string
}

export interface ApiClient {
  /** The themes, and whether the host allows several (`themes.multiple`). */
  listThemes(): Promise<{ themes: Theme[]; multiple: boolean }>
  /** A theme, or null when it does not exist. */
  getTheme(id: string): Promise<ThemeResult | null>
  /** A new theme without files. */
  createTheme(input: { name: string; role: ThemeRole }): Promise<ThemeResult>
  renameTheme(id: string, name: string): Promise<ThemeResult>
  /** Upload a package (full, or only changed files + manifest.json) into a theme. */
  pushFiles(id: string, pkg: Uint8Array, opts?: { expect?: string }): Promise<ThemeResult>
  /** A file of a theme, or null when missing. */
  readFile(id: string, path: string): Promise<Uint8Array | null>
  publishTheme(id: string): Promise<ThemeResult>
  duplicateTheme(id: string, opts?: { name?: string }): Promise<ThemeResult>
  deleteTheme(id: string): Promise<void>
}

export function createClient(target: ApiTarget): ApiClient {
  if (!target.url) throw new Error('the artifacts API URL is required (--url, PUCK_REMOTE_URL or url in puck-remote.cli.ts)')
  const base = target.url.replace(/\/+$/, '')
  const send = target.fetch ?? ((r: Request) => fetch(r))

  async function call(method: string, path: string, body?: { json: unknown } | { bytes: Uint8Array }): Promise<Response> {
    const extra = typeof target.headers === 'function' ? await target.headers() : target.headers
    const headers: Record<string, string> = { ...extra }
    let payload: BodyInit | undefined
    if (body && 'json' in body) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body.json)
    } else if (body) {
      headers['content-type'] = 'application/gzip'
      payload = new Uint8Array(body.bytes)
    }
    const res = await send(new Request(`${base}${path}`, { method, headers, body: payload }))
    if (res.ok || (res.status === 404 && method === 'GET' && path !== '')) return res
    const text = await res.text().catch(() => '')
    let message = text
    try {
      message = JSON.parse(text).error ?? text
    } catch {}
    throw new ApiError(res.status, `${method} ${path || '/'}: ${res.status} ${message || res.statusText}`)
  }

  const seg = (s: string) => encodeURIComponent(s)

  return {
    async listThemes() {
      return (await call('GET', '')).json()
    },
    async getTheme(id) {
      const res = await call('GET', `/${seg(id)}`)
      return res.status === 404 ? null : res.json()
    },
    async createTheme(input) {
      return (await call('POST', '', { json: input })).json()
    },
    async renameTheme(id, name) {
      return (await call('PATCH', `/${seg(id)}`, { json: { name } })).json()
    },
    async pushFiles(id, pkg, opts = {}) {
      const q = opts.expect ? `?expect=${seg(opts.expect)}` : ''
      return (await call('POST', `/${seg(id)}/files${q}`, { bytes: pkg })).json()
    },
    async readFile(id, path) {
      const res = await call('GET', `/${seg(id)}/files/${path.split('/').map(seg).join('/')}`)
      if (res.status === 404) return null
      return new Uint8Array(await res.arrayBuffer())
    },
    async publishTheme(id) {
      return (await call('POST', `/${seg(id)}/publish`)).json()
    },
    async duplicateTheme(id, opts = {}) {
      return (await call('POST', `/${seg(id)}/duplicate`, { json: opts })).json()
    },
    async deleteTheme(id) {
      await call('DELETE', `/${seg(id)}`)
    },
  }
}
