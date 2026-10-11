/** Cookie holding a preview token on public origins (set by the preview route). Edge-safe. */
export const PREVIEW_COOKIE = 'puck_remote_preview'

/** Cookie holding the live reload URL of a `puck-remote dev` session (set by the preview route). Edge-safe. */
export const RELOAD_COOKIE = 'puck_remote_reload'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * The origin of a live reload server URL, or null unless it is http on the loopback interface with
 * an explicit port (`http://127.0.0.1:9293`). Anything else is ignored: the page only ever
 * listens to the developer's own machine.
 */
export function reloadOrigin(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 64) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname) || !u.port || u.username || u.password) return null
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null
  return u.origin
}
