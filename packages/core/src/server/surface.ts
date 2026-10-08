/**
 * Surfaces and origins. A host app answers two kinds of pages:
 *
 *   site    public pages (theme scripts run here)
 *   admin   the host's own pages that embed the editor iframe and hold the session (origins.host)
 *   editor  the app's editor page (<PuckRemoteEditor>), on origins.editor, credential-free
 *
 * The editor itself is a separate static app on its own origin (see config `origins`). Keeping
 * the admin and the editor on different origins is what stops theme code running in the editor
 * from using the admin's session. Proxy-safe: no isolate imports.
 */

export type Surface = 'site' | 'admin' | 'editor'

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

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export type CspMode = 'enforce' | 'report-only' | false

export interface SecurityPolicy {
  csp: { admin: CspMode; site: CspMode; editor: CspMode }
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
  csp: { admin: 'enforce', site: 'report-only', editor: 'enforce' },
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
 * `editorOrigin` is the only frame an admin page may embed; `hostOrigins` are the only pages that
 * may embed the editor.
 */
export function securityHeaders(surface: Surface, opts: { nonce: string; dev?: boolean; policy?: SecurityPolicy; editorOrigin?: string; hostOrigins?: string[] }): Record<string, string> {
  const policy = opts.policy ?? DEFAULT_SECURITY
  const n = `'nonce-${opts.nonce}'`
  const devEval = opts.dev ? ["'unsafe-eval'"] : []
  const headers: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' }
  if (surface === 'editor') {
    // Credential-free and framed by host pages only. The theme's browser bundle and assets come
    // from the host origin's theme route.
    const hosts = opts.hostOrigins ?? []
    Object.assign(headers, { 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin' })
    if (policy.csp.editor) {
      const csp = directives({
        'default-src': ["'self'"],
        'script-src': ["'self'", n, "'strict-dynamic'", ...hosts, ...devEval],
        'style-src': ["'self'", "'unsafe-inline'", ...hosts],
        'img-src': ['*', 'data:', 'blob:'],
        'font-src': ["'self'", 'data:', ...hosts],
        'connect-src': ["'self'", ...(opts.dev ? ['ws:'] : [])],
        // Puck renders its canvas in a same-origin iframe.
        'frame-src': ["'self'", 'blob:', 'data:'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'none'"],
        'frame-ancestors': hosts.length ? hosts : ["'none'"],
      })
      headers[policy.csp.editor === 'enforce' ? 'content-security-policy' : 'content-security-policy-report-only'] = csp
    }
  } else if (surface === 'admin') {
    Object.assign(headers, { 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin' })
    if (policy.csp.admin) {
      const csp = directives({
        'default-src': ["'self'"],
        'script-src': ["'self'", n, "'strict-dynamic'", ...devEval],
        // Puck uses inline styles.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'https:', 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", ...(opts.dev ? ['ws:'] : [])],
        'frame-src': opts.editorOrigin ? [opts.editorOrigin] : ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      })
      headers[policy.csp.admin === 'enforce' ? 'content-security-policy' : 'content-security-policy-report-only'] = csp
    }
  } else {
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
