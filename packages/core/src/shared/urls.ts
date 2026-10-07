/** URL layout of the theme route, shared by server and editor (client-safe: no Node imports). */
const trim = (route: string) => route.replace(/\/+$/, '')

/** e.g. /theme/v3/assets/ */
export const themeAssetBase = (themeRoute: string, version: number) => `${trim(themeRoute)}/v${version}/assets/`
/** e.g. /theme/v3/bundle.js — served to the editor only. */
export const themeBundleUrl = (themeRoute: string, version: number) => `${trim(themeRoute)}/v${version}/bundle.js`
/** e.g. /api/blocks/resolve */
export const apiUrl = (apiRoute: string, path: string) => `${trim(apiRoute)}/${path}`
