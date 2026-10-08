/**
 * The demo's own admin auth (puck-remote has none: authority belongs to the host app).
 * Development: open. Production: PUCK_REMOTE_ADMIN_TOKEN as a Bearer header or the
 * `puck_remote_token` cookie. Replace with your real session check.
 */
import { timingSafeEqual } from 'node:crypto'

export function isAdmin(request: Request): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  const expected = process.env.PUCK_REMOTE_ADMIN_TOKEN
  if (!expected) return false
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)puck_remote_token=([^;]+)/)?.[1]
  const given = bearer ?? (cookie ? decodeURIComponent(cookie) : null)
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
