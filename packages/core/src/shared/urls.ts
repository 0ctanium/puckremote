/** URL layout of the theme route, shared by server and editor (client-safe: no Node imports). */
const trim = (route: string) => route.replace(/\/+$/, '')

/** e.g. /theme/<id>/ */
export const themeBase = (themeRoute: string, id: string) => `${trim(themeRoute)}/${encodeURIComponent(id)}/`
/** e.g. /theme/<id>/assets/ */
export const themeAssetBase = (themeRoute: string, id: string) => `${themeBase(themeRoute, id)}assets/`
