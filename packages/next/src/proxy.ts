/**
 * Next.js proxy (middleware) factory. For every request:
 *  - security headers: admin origins get the admin policy (no framing, only the editor origin
 *    may be framed); every other origin gets the public-site policy (CSP with a per-request nonce);
 *  - cache headers for public pages (pages using URL query params are never cacheable).
 * Imports only @puck-remote/core/edge (no isolate, no workers).
 *
 *   // src/proxy.ts
 *   export const proxy = createProxy(remoteConfig)
 *   export const config = { matcher: ['/((?!_next/|favicon\\.ico).*)'] }
 */
import { cspNonce, normalizeOrigin, normalizeSlug, pageCacheability, requestOrigin, securityHeaders, DEFAULT_SECURITY, type SecurityPolicy } from '@puck-remote/core/edge'
import type { PuckRemoteConfig } from '@puck-remote/core/config'
import { NextResponse, type NextRequest } from 'next/server'

export function createProxy(config: Pick<PuckRemoteConfig, 'artifacts' | 'origins' | 'security'>) {
  const admin = (config.origins?.admin ?? []).map(normalizeOrigin)
  const editorOrigin = config.origins ? normalizeOrigin(config.origins.editor) : undefined
  const s = config.security ?? {}
  const policy = { ...DEFAULT_SECURITY, ...s, csp: { ...DEFAULT_SECURITY.csp, ...s.csp } } as SecurityPolicy
  return async function proxy(req: NextRequest) {
    const surface = admin.includes(requestOrigin(req)) ? 'admin' : 'site'
    const nonce = cspNonce()
    const headers = securityHeaders(surface, { nonce, dev: process.env.NODE_ENV !== 'production', policy, editorOrigin })
    const csp = headers['content-security-policy'] ?? headers['content-security-policy-report-only']
    // Next reads the nonce from the request's CSP header (and pages from x-nonce) for its scripts.
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set('x-nonce', nonce)
    if (csp) requestHeaders.set('content-security-policy', csp)
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    if (surface !== 'site') return res
    const slug = normalizeSlug(req.nextUrl.pathname)
    if (!slug) return res
    const c = await pageCacheability(config, slug).catch(() => null)
    if (!c) return res
    if (c.cacheable) res.headers.set('x-page-cacheable', 'true')
    else {
      res.headers.set('cache-control', 'no-store')
      res.headers.set('x-page-cacheable', 'false')
      res.headers.set('x-uncacheable-blocks', c.blocks.join(','))
    }
    return res
  }
}
