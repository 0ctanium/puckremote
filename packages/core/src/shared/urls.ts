/** URL layout of the theme route, shared by server and editor (client-safe: no Node imports). */
const trim = (route: string) => route.replace(/\/+$/, '')

/** e.g. /theme/v3/assets/ */
export const themeAssetBase = (themeRoute: string, version: number) => `${trim(themeRoute)}/v${version}/assets/`
/** e.g. /api/blocks/resolve */
export const apiUrl = (apiRoute: string, path: string) => `${trim(apiRoute)}/${path}`
