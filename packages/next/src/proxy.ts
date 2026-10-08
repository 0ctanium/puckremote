/**
 * Next.js proxy (middleware) factory. For every request:
 *  - 404 when the request's origin doesn't serve its surface (editor/API only on editor origins,
 *    public pages only on site origins);
 *  - cache headers for public pages (pages using URL query params are never cacheable).
 * Imports only @puck-remote/core/edge (no isolate, no workers).
 *
 *   // src/proxy.ts
 *   export const proxy = createProxy(remoteConfig)
 *   export const config = { matcher: ['/((?!_next/|favicon\\.ico).*)'] }
 */
import { classifyRequest, normalizeSlug, pageCacheability, resolveSurfaces } from '@puck-remote/core/edge'
import type { PuckRemoteConfig } from '@puck-remote/core/config'
import { NextResponse, type NextRequest } from 'next/server'

export function createProxy(config: Pick<PuckRemoteConfig, 'artifacts' | 'pages' | 'routes' | 'origins' | 'allowSharedOrigin'>) {
  const surfaces = resolveSurfaces(config)
  return async function proxy(req: NextRequest) {
    const where = classifyRequest(req, surfaces)
    if (!where.allowed) return new NextResponse('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
    const res = NextResponse.next()
    if (where.surface !== 'site') return res
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
