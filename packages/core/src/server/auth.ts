/**
 * Authentication, authorization and CSRF for the editor and its API. Framework-agnostic: only
 * the standard Request/Response are involved. Safe to import from config/proxy code (no isolate).
 */
import { timingSafeEqual } from 'node:crypto'
import type { Action, AuthAdapter, Principal } from '@puck-remote/sdk/host'
import { requestOrigin } from './surface.ts'

export class AccessDeniedError extends Error {
  constructor(
    readonly status: 401 | 403,
    message = status === 401 ? 'authentication required' : 'forbidden',
  ) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

/** Development only: everyone may do everything. Throws if used in production. */
export function devAllowAll(): AuthAdapter {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('puck-remote: devAllowAll() must not be used in production')
  }
  return {
    authenticate: async () => ({ id: 'dev', name: 'Developer' }),
    authorize: () => true,
  }
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Minimal built-in adapter: a single shared secret, sent as `Authorization: Bearer <secret>` or
 * in a cookie. Fine for small self-hosted setups and CI; use a real adapter (Payload…) otherwise.
 */
export function sharedSecretAuth(opts: { secret: string | undefined; cookie?: string; actions?: readonly Action[] }): AuthAdapter {
  const cookieName = opts.cookie ?? 'puck_remote_token'
  return {
    async authenticate(request) {
      const secret = opts.secret
      if (!secret) return null // misconfigured: deny everyone rather than allow
      const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
      const cookie = (request.headers.get('cookie') ?? '')
        .split(';')
        .map((c) => c.trim().split('='))
        .find(([k]) => k === cookieName)?.[1]
      const token = bearer ?? (cookie ? decodeURIComponent(cookie) : undefined)
      return token && safeEqual(token, secret) ? { id: 'admin', name: 'Administrator' } : null
    },
    authorize: (_p, action) => !opts.actions || opts.actions.includes(action),
  }
}

/**
 * Authenticate + authorize a request. With `auth === null` (development without an adapter,
 * already warned about at startup) everything is allowed.
 */
export async function authorizeRequest(auth: AuthAdapter | null, request: Request, action: Action, resource?: { slug?: string }): Promise<Principal | null> {
  if (!auth) return null
  const principal = await auth.authenticate(request).catch(() => null)
  if (!principal) throw new AccessDeniedError(401)
  const allowed = await Promise.resolve(auth.authorize(principal, action, resource)).catch(() => false)
  if (!allowed) throw new AccessDeniedError(403)
  return principal
}

export const CSRF_HEADER = 'x-puck-remote'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defense for state-changing requests:
 *  - a custom header is required: browsers can't send it cross-origin without a CORS preflight
 *    (which we never grant), and HTML forms can't set it at all;
 *  - if the browser tells us the origin (Origin / Sec-Fetch-Site), it must be ours or allowlisted.
 * Non-browser clients (CLI, CI) send the header and authenticate with a bearer token.
 */
export function checkCsrf(request: Request, allowedOrigins: readonly string[]): AccessDeniedError | null {
  if (SAFE_METHODS.has(request.method)) return null
  if (request.headers.get(CSRF_HEADER) !== '1') return new AccessDeniedError(403, `missing ${CSRF_HEADER} header`)
  const own = requestOrigin(request)
  const origin = request.headers.get('origin')
  if (origin && origin !== own && !allowedOrigins.includes(origin)) return new AccessDeniedError(403, `origin ${origin} not allowed`)
  const site = request.headers.get('sec-fetch-site')
  if (!origin && site && site !== 'same-origin' && site !== 'none') return new AccessDeniedError(403, 'cross-site request')
  return null
}
