/**
 * URL layout of the theme route, shared by server and editor (client-safe: no Node imports).
 * Shopify-like: the path names the file, `?v=` its version (D-0262):
 *
 *   /cdn/assets/theme.css?v=3fa9c2d81b04   (v = first 12 hex chars of the file's sha256)
 */
const trim = (route: string) => route.replace(/\/+$/, '')

/** Length of `v`, in hex characters of the file's sha256. */
export const VERSION_LENGTH = 12

export const themeVersion = (sha256: string) => sha256.slice(0, VERSION_LENGTH)

/** e.g. /cdn/bundle.islands.js?v=8e01d77a2c55 (no `?v` without a hash). */
export const themeFileUrl = (themeRoute: string, path: string, sha256?: string) =>
  `${trim(themeRoute)}/${path}${sha256 ? `?v=${themeVersion(sha256)}` : ''}`

/** e.g. /cdn/assets/ */
export const themeAssetBase = (themeRoute: string) => `${trim(themeRoute)}/assets/`

/** Versions of the theme's assets, keyed by path below assets/ (what ctx.assetUrl receives). */
export function assetVersions(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [p, sha] of Object.entries(files)) if (p.startsWith('assets/')) out[p.slice('assets/'.length)] = themeVersion(sha)
  return out
}
