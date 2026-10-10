/**
 * Host wiring: the only place that knows where artifacts (theme code + templates) and data live.
 * Swap the plugins for a real backend (Payload, SQL, a headless CMS, S3…) without touching @puck-remote/core.
 */
import path from 'node:path'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { defineConfig } from '@puck-remote/core/config'
import { mockCms } from '@puck-remote/source-mock'

// Runtime data in <app>/data, never bundled (excluded from build tracing). Next runs with the app
// dir as cwd; import.meta.dirname is not available inside Next's server bundles.
const root = process.env.PUCK_REMOTE_ROOT ?? path.resolve(/*turbopackIgnore: true*/ process.cwd())
const MOCK_API = process.env.PUCK_REMOTE_MOCK_API_ORIGIN ?? 'http://localhost:4010'
const dev = process.env.NODE_ENV !== 'production' || !!process.env.PUCK_REMOTE_ALLOW_DEV_ORIGINS
const PORT = process.env.PORT ?? '3100'
// One app, three origins: admin pages (editor frame, publish) on the host origin, the editor page
// (<PuckRemoteEditor>, reached through the proxy) on another site, and the public site on every
// other hostname. Dev: http://admin.localhost:3100 (admin), http://127.0.0.1:3100 (editor),
// http://localhost:3100 (site).
const HOST_ORIGINS = (process.env.PUCK_REMOTE_ADMIN_ORIGINS ?? `http://admin.localhost:${PORT}`).split(',')
const EDITOR_ORIGIN = process.env.PUCK_REMOTE_EDITOR_ORIGIN ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  artifacts: fsArtifactStore({ dir: path.join(root, 'data', 'artifacts') }),
  source: mockCms({ dataFile: path.join(root, 'data', 'cms.json') }),
  origins: { host: HOST_ORIGINS, editor: EDITOR_ORIGIN },
  site: { name: 'POC Site', locale: 'en' },
  http: { allowedOrigins: [MOCK_API], insecureDevOrigins: dev ? [MOCK_API] : [] },
  secrets: { EVENTS_API_KEY: { value: process.env.EVENTS_API_KEY ?? 'dev-events-key-7f3a9c', origins: [MOCK_API] } },
  // Every template gets these root fields (the theme's own come after). The theme types them in
  // its puck-remote-env.d.ts (Register.rootProps); the public page builds its metadata from them.
  root: {
    fields: {
      title: { type: 'text', label: 'Page title' },
      description: { type: 'textarea', label: 'Meta description' },
    },
    defaultProps: { title: 'Untitled page', description: '' },
  },
})
