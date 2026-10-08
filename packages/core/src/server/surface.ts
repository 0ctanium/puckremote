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
