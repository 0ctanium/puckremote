/**
 * Next.js proxy (middleware) factory: cache headers for public pages. Pages using URL query
 * params ($query) are never cacheable. Imports only @poc/core/cacheability (no isolate).
 *
 *   // src/proxy.ts
 *   export const proxy = createProxy(pocConfig)
 *   export const config = { matcher: ['/((?!_next/|api/|editor(?:/|$)|theme/|favicon\.ico).*)'] }
 */
import type { PocConfigInput } from '@poc/core/config'
import { normalizeSlug, pageCacheability } from '@poc/core/cacheability'
import { NextResponse, type NextRequest } from 'next/server'

export function createProxy(config: Pick<PocConfigInput, 'artifactsDir' | 'pages'>) {
  return async function proxy(req: NextRequest) {
    const res = NextResponse.next()
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
