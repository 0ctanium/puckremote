/**
 * Host wiring: the only place that knows where artifacts, pages and data live.
 * Swap the plugins for a real backend (Payload, SQL, a headless CMS, S3…) without touching @poc/core.
 */
import path from 'node:path'
import { definePocConfig } from '@poc/core/config'
import { fsPageStore } from '@poc/pages-fs'
import { mockCms } from '@poc/source-mock'

// Runtime data, never bundled (excluded from build tracing). Next runs with the app dir as cwd;
// import.meta.dirname is not available inside Next's server bundles.
const root = process.env.POC_ROOT ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), '../..')
const MOCK_API = process.env.POC_MOCK_API_ORIGIN ?? 'http://localhost:4010'
const dev = process.env.NODE_ENV !== 'production' || !!process.env.POC_ALLOW_DEV_ORIGINS

export default definePocConfig({
  artifactsDir: path.join(root, 'artifacts'),
  source: mockCms({ dataFile: path.join(root, 'data', 'cms.json') }),
  pages: fsPageStore({ dir: path.join(root, 'data', 'pages') }),
  site: { name: 'POC Site', locale: 'en' },
  http: { allowedOrigins: [MOCK_API], insecureDevOrigins: dev ? [MOCK_API] : [] },
  secrets: { EVENTS_API_KEY: { value: process.env.EVENTS_API_KEY ?? 'dev-events-key-7f3a9c', origins: [MOCK_API] } },
})
