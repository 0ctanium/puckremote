/**
 * Preview of non-main themes on public pages. A signed link (created for someone allowed to see the
 * theme, e.g. by the artifacts API or an admin page) opens the preview route on the site's origin,
 * which stores the token in an HttpOnly cookie; template rendering then uses that theme.
 *
 *   token = base64url(JSON { t: theme id, exp: unix seconds }) "." base64url(HMAC-SHA256(secret, payload))
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { PREVIEW_COOKIE, RELOAD_COOKIE, reloadOrigin } from '../shared/preview-cookie.ts'
import type { HostConfig, PreviewConfig } from './config.ts'
import { isThemeId } from './themes.ts'

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

export function createPreviewToken(preview: PreviewConfig, theme: string, now = Date.now()): string {
  if (!isThemeId(theme)) throw new Error(`invalid theme id ${JSON.stringify(theme)}`)
  const payload = Buffer.from(JSON.stringify({ t: theme, exp: Math.floor(now / 1000) + preview.ttlSeconds })).toString('base64url')
  return `${payload}.${sign(preview.secret, payload)}`
}

/** The theme id and expiry of a valid, unexpired token, or null. */
export function verifyPreviewToken(preview: PreviewConfig, token: unknown, now = Date.now()): { theme: string; exp: number } | null {
  if (typeof token !== 'string' || token.length > 512) return null
  const [payload, mac, extra] = token.split('.')
  if (!payload || !mac || extra !== undefined) return null
  const expected = Buffer.from(sign(preview.secret, payload))
  const given = Buffer.from(mac)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const { t, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!isThemeId(t) || typeof exp !== 'number' || exp * 1000 <= now) return null
    return { theme: t, exp }
  } catch {
    return null
  }
}

/**
 * Link that starts a preview of a theme on the site's origin, or null: main theme, a theme without
 * files, single-theme mode, or preview / origins.site not configured.
 */
export function previewUrl(config: HostConfig, theme: { id: string; role: string; hash?: string | null }, now = Date.now()): string | null {
  const site = config.origins?.site
  if (!config.preview || !site || !config.themes.multiple || theme.role === 'main' || theme.hash === null) return null
  return `${site}${config.routes.preview}?token=${createPreviewToken(config.preview, theme.id, now)}`
}

/** Reads the preview cookie out of a Cookie header (or takes the cookie value itself). */
export function previewCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === PREVIEW_COOKIE) return part.slice(i + 1).trim()
  }
  return null
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`

/**
 * GET <routes.preview>?token=… starts a preview of a theme, ?exit ends it; both redirect to `/`.
 * `&reload=http://127.0.0.1:<port>` (a `puck-remote dev` live reload server, loopback only) is kept
 * in a second cookie so preview pages reload after each push.
 */
export function handlePreview(config: HostConfig, request: Request, now = Date.now()): Response {
  const noStore = { 'cache-control': 'no-store' }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET', ...noStore } })
  if (!config.preview) return new Response('Not found', { status: 404, headers: noStore })
  const url = new URL(request.url)
  if (url.searchParams.has('exit')) {
    const headers = new Headers({ location: '/', ...noStore })
    headers.append('set-cookie', cookie(PREVIEW_COOKIE, '', 0))
    headers.append('set-cookie', cookie(RELOAD_COOKIE, '', 0))
    return new Response(null, { status: 302, headers })
  }
  const token = url.searchParams.get('token')
  const ok = verifyPreviewToken(config.preview, token, now)
  if (!ok) return new Response('Invalid or expired preview link', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8', ...noStore } })
  const maxAge = Math.max(0, ok.exp - Math.floor(now / 1000))
  const headers = new Headers({ location: '/', ...noStore })
  headers.append('set-cookie', cookie(PREVIEW_COOKIE, token!, maxAge))
  const reload = reloadOrigin(url.searchParams.get('reload'))
  // A preview link without a (valid) reload URL clears any earlier one.
  headers.append('set-cookie', reload ? cookie(RELOAD_COOKIE, encodeURIComponent(reload), maxAge) : cookie(RELOAD_COOKIE, '', 0))
  return new Response(null, { status: 302, headers })
}
