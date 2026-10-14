/**
 * Host wiring: everything lives in Payload. Themes' data comes from its collections (Local API, as
 * the requesting user); the themes and their files are stored in its database.
 */
import { defineConfig } from '@puck-remote/core/config'
import { payloadArtifactStore } from '@puck-remote/payload/artifacts'
import { payloadSource } from '@puck-remote/payload/source'
import { EDITOR_ORIGIN, HOST_ORIGINS, SITE_ORIGIN } from './src/origins.ts'
import { payload } from './src/payload.ts'
import type { Config } from './src/payload-types.ts'

const PREVIEW_SECRET =
  process.env.PUCK_REMOTE_PREVIEW_SECRET ?? (process.env.NODE_ENV === 'production' ? null : 'local-dev-only-preview-secret')

export default defineConfig({
  // The collections come from puckRemotePlugin (src/payload.config.ts).
  artifacts: payloadArtifactStore({ payload }),
  // The same policy as examples/app's mock: themes reach these fields only. Each query runs as the
  // request's Payload user: visitors see published posts, admin users drafts too.
  source: payloadSource<Config>()({
    payload,
    collections: {
      posts: {
        fields: {
          title: { type: 'text' },
          slug: { type: 'text', filter: ['equals', 'in'] },
          excerpt: { type: 'text', filter: false, sort: false },
          publishedAt: { type: 'date', filter: ['gt', 'lt', 'equals'] },
          status: { type: 'text', filter: ['equals', 'in'] },
          author: { type: 'relation', to: 'authors', filter: ['equals', 'in'] },
        },
        limits: { default: 10, max: 12, maxDepth: 1 },
      },
      authors: {
        fields: { name: { type: 'text' }, bio: { type: 'text', filter: false, sort: false } },
        limits: { default: 10, max: 50 },
      },
    },
    globals: { site: { fields: { tagline: { type: 'text' }, footer: { type: 'text' } } } },
  }),
  origins: { host: HOST_ORIGINS, editor: EDITOR_ORIGIN, site: SITE_ORIGIN },
  preview: PREVIEW_SECRET ? { secret: PREVIEW_SECRET } : null,
  themes: { multiple: true },
  site: { name: 'Payload example', locale: 'en' },
  root: {
    fields: {
      title: { type: 'text', label: 'Page title' },
      description: { type: 'textarea', label: 'Meta description' },
    },
    defaultProps: { title: 'Untitled page', description: '' },
  },
})
