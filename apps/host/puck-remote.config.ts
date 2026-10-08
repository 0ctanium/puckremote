/**
 * Host wiring: the only place that knows where artifacts, pages and data live.
 * Swap the plugins for a real backend (Payload, SQL, a headless CMS, S3…) without touching @puck-remote/core.
 */
import path from 'node:path'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { defineConfig, devAllowAll, sharedSecretAuth } from '@puck-remote/core/config'
import { fsPageStore } from '@puck-remote/pages-fs'
import { mockCms } from '@puck-remote/source-mock'

// Runtime data, never bundled (excluded from build tracing). Next runs with the app dir as cwd;
// import.meta.dirname is not available inside Next's server bundles.
const root = process.env.PUCK_REMOTE_ROOT ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), '../..')
const MOCK_API = process.env.PUCK_REMOTE_MOCK_API_ORIGIN ?? 'http://localhost:4010'
const dev = process.env.NODE_ENV !== 'production' || !!process.env.PUCK_REMOTE_ALLOW_DEV_ORIGINS

export default defineConfig({
  artifacts: fsArtifactStore({ dir: path.join(root, 'artifacts') }),
  source: mockCms({ dataFile: path.join(root, 'data', 'cms.json') }),
  pages: fsPageStore({ dir: path.join(root, 'data', 'pages') }),
  // Dev: open editor. Production: a shared admin secret (Bearer header or `puck_remote_token` cookie).
  // Swap for a real adapter (e.g. Payload sessions) in a real deployment.
  auth: process.env.NODE_ENV === 'production' ? sharedSecretAuth({ secret: process.env.PUCK_REMOTE_ADMIN_TOKEN }) : devAllowAll(),
  site: { name: 'POC Site', locale: 'en' },
  http: { allowedOrigins: [MOCK_API], insecureDevOrigins: dev ? [MOCK_API] : [] },
  secrets: { EVENTS_API_KEY: { value: process.env.EVENTS_API_KEY ?? 'dev-events-key-7f3a9c', origins: [MOCK_API] } },
})
