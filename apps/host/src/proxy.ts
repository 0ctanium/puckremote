import { NextResponse, type NextRequest } from 'next/server'
import { pageCacheability } from './server/cacheability.ts'
import { normalizeSlug } from './server/pages.ts'

/** Sets cache headers for public pages: $query-dependent pages are never cacheable. */
export async function proxy(req: NextRequest) {
  const slug = normalizeSlug(req.nextUrl.pathname)
  const res = NextResponse.next()
  if (!slug) return res
  const c = await pageCacheability(slug).catch(() => null)
  if (!c) return res
  if (c.cacheable) res.headers.set('x-page-cacheable', 'true')
  else {
    res.headers.set('cache-control', 'no-store')
    res.headers.set('x-page-cacheable', 'false')
    res.headers.set('x-uncacheable-blocks', c.blocks.join(','))
  }
  return res
}

export const config = {
  matcher: ['/((?!_next|api|editor|theme-assets|theme-bundle|favicon.ico).*)'],
}
