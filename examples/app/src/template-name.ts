// This app's routing: each path renders the template of the same name ('' → home). Pure (no
// imports), so the proxy can use it too.
const NAME = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/

/** Path (or catch-all segments) → template name, or null when the path can't name a template. */
export function normalizeSlug(parts: string[] | string | undefined): string | null {
  const slug = (Array.isArray(parts) ? parts.join('/') : (parts ?? '')).replace(/^\/+|\/+$/g, '') || 'home'
  return NAME.test(slug) ? slug : null
}
