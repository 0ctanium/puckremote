// One app, three origins: Payload's admin (and the artifacts API) on the host origin, the editor
// page (<PuckRemoteEditor>) on another site, and the public site on every other hostname.
// Dev: http://admin.localhost:3300/admin, http://127.0.0.1:3300, http://localhost:3300.
// Its own module: the Payload config (editor URL) and puck-remote.config.ts both read it.
const PORT = process.env.PORT ?? '3300'

export const HOST_ORIGINS = (process.env.PUCK_REMOTE_ADMIN_ORIGINS ?? `http://admin.localhost:${PORT}`).split(',')
export const EDITOR_ORIGIN = process.env.PUCK_REMOTE_EDITOR_ORIGIN ?? `http://127.0.0.1:${PORT}`
export const SITE_ORIGIN = `http://localhost:${PORT}`
