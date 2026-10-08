/**
 * Surfaces and origins. One app can answer several hostnames; each request belongs to a surface:
 *
 *   site    public pages                  → only on `origins.site`
 *   editor  the editor UI                 → only on `origins.editor`
 *   api     editor API (drafts, saves…)   → only on `origins.editor`
 *   theme   theme assets (CSS, scripts…)  → on both (the editor canvas loads theme CSS)
 *
 * Keeping the editor on its own origin is what stops theme scripts running on the public site
 * from using an admin's session. Proxy-safe: no isolate imports.
 */
import type { Routes } from './config.ts'

export type Surface = 'site' | 'editor' | 'api' | 'theme'

export interface OriginsConfig {
  site: string[]
  editor: string[]
}

const under = (pathname: string, prefix: string) => {
  const p = prefix.replace(/\/+$/, '')
  return pathname === p || pathname.startsWith(p + '/')
}

export function surfaceOf(pathname: string, routes: Routes): Surface {
  if (under(pathname, routes.api)) return 'api'
  if (under(pathname, routes.theme)) return 'theme'
  if (under(pathname, routes.editor)) return 'editor'
  return 'site'
}

/**
 * The origin the client actually addressed. Frameworks don't always put it in request.url (Next
 * builds it from the server's bound host), so prefer X-Forwarded-Host/Proto, then Host. A browser
 * cannot set these for another site, so this is safe for routing; CSRF still checks `Origin`.
 * Behind your own reverse proxy, make it forward X-Forwarded-Host/Proto (or preserve Host).
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null
  const host = first(request.headers.get('x-forwarded-host')) ?? first(request.headers.get('host'))
  if (!host || !/^[A-Za-z0-9.\-\[\]:]+$/.test(host)) return url.origin
  const proto = first(request.headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '')
  try {
    return new URL(`${proto === 'https' ? 'https' : 'http'}://${host}`).origin
  } catch {
    return url.origin
  }
}

/** Canonical origin string (scheme://host[:port]); throws on invalid input. */
export function normalizeOrigin(origin: string): string {
  return new URL(origin).origin
}

export function classifyRequest(
  request: Request,
  config: { routes: Routes; origins: OriginsConfig | null },
): { surface: Surface; origin: string; allowed: boolean } {
  const surface = surfaceOf(new URL(request.url).pathname, config.routes)
  const origin = requestOrigin(request)
  if (!config.origins) return { surface, origin, allowed: true } // single-origin mode (development)
  const { site, editor } = config.origins
  const allowed =
    surface === 'site' ? site.includes(origin) : surface === 'theme' ? site.includes(origin) || editor.includes(origin) : editor.includes(origin)
  return { surface, origin, allowed }
}

/** A request reached a surface its origin doesn't serve. Bindings should answer 404. */
export class WrongSurfaceError extends Error {
  readonly status = 404
  constructor(surface: Surface, origin: string) {
    super(`${surface} is not served on ${origin}`)
    this.name = 'WrongSurfaceError'
  }
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export type CspMode = 'enforce' | 'report-only' | false

export interface SecurityPolicy {
  csp: { editor: CspMode; site: CspMode }
  /** https origins theme scripts may load from on the public site (besides the theme's own assets). */
  scriptOrigins: string[]
  /** https origins theme stylesheets may load from (besides the theme's own assets). */
  styleOrigins: string[]
  /** Where theme client scripts may connect (fetch/XHR/WebSocket). */
  connectSrc: string[]
  /** What the public site may embed in iframes. */
  frameSrc: string[]
  /** Who may frame the public site. */
  frameAncestors: string[]
}

export const DEFAULT_SECURITY: SecurityPolicy = {
  csp: { editor: 'enforce', site: 'report-only' },
  scriptOrigins: [],
  styleOrigins: [],
  connectSrc: ['https:'],
  frameSrc: ['https:'],
  frameAncestors: ["'self'"],
}

/** A fresh CSP nonce (base64, 128 bits). Edge-safe (Web Crypto). */
export function cspNonce(): string {
  const b = new Uint8Array(16)
  globalThis.crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b))
}

const directives = (d: Record<string, string[]>) =>
  Object.entries(d)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ')

/**
 * Response headers for a surface. `nonce` must also reach the framework (Next reads it from the
 * request's CSP header) and the theme <script> tags. `dev` relaxes what dev servers need.
 */
export function securityHeaders(surface: Surface, opts: { nonce: string; dev?: boolean; policy?: SecurityPolicy }): Record<string, string> {
  const policy = opts.policy ?? DEFAULT_SECURITY
  const n = `'nonce-${opts.nonce}'`
  const devEval = opts.dev ? ["'unsafe-eval'"] : []
  const headers: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' }
  if (surface === 'editor') {
    Object.assign(headers, { 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin' })
    if (policy.csp.editor) {
      const csp = directives({
        'default-src': ["'self'"],
        'script-src': ["'self'", n, "'strict-dynamic'", ...devEval],
        // Puck uses inline styles.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'https:', 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", ...(opts.dev ? ['ws:'] : [])],
        'frame-src': ["'self'", 'blob:', 'data:'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      })
      headers[policy.csp.editor === 'enforce' ? 'content-security-policy' : 'content-security-policy-report-only'] = csp
    }
  } else if (surface === 'site') {
    if (policy.csp.site) {
      const csp = directives({
        'default-src': ["'self'"],
        // Nonce + strict-dynamic: our script tags carry the nonce; scripts they load are trusted.
        // The origin list is the fallback for browsers without strict-dynamic.
        'script-src': ["'self'", n, "'strict-dynamic'", ...policy.scriptOrigins, ...devEval],
        'style-src': ["'self'", "'unsafe-inline'", ...policy.styleOrigins],
        'img-src': ['*', 'data:', 'blob:'],
        'font-src': ["'self'", 'https:', 'data:'],
        'connect-src': ["'self'", ...policy.connectSrc, ...(opts.dev ? ['ws:'] : [])],
        'frame-src': policy.frameSrc,
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': policy.frameAncestors,
      })
      headers[policy.csp.site === 'enforce' ? 'content-security-policy' : 'content-security-policy-report-only'] = csp
    }
  }
  return headers
}
