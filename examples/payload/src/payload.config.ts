/**
 * The example's Payload: the same content as examples/app's mock CMS (posts with drafts, authors,
 * a `site` global), on SQLite in data/payload.db. Admin users log into Payload's admin on the
 * admin origin; the CLI uses their API keys.
 */
import path from 'node:path'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { puckRemotePlugin } from '@puck-remote/payload/plugin'
import { buildConfig, type CollectionConfig } from 'payload'
import { EDITOR_ORIGIN } from './origins.ts'

// Next runs with the app dir as cwd (import.meta.dirname is not available in its server bundles).
const root = process.env.PUCK_REMOTE_ROOT ?? path.resolve(/*turbopackIgnore: true*/ process.cwd())
const production = process.env.NODE_ENV === 'production'

function secret(): string {
  const s = process.env.PAYLOAD_SECRET
  if (s) return s
  if (production) throw new Error('PAYLOAD_SECRET is required in production')
  return 'local-dev-only-payload-secret' // Local development only.
}

const Users: CollectionConfig = {
  slug: 'users',
  // API keys: what the CLI sends (puck-remote.cli.ts) to push themes.
  auth: { useAPIKey: true },
  admin: { useAsTitle: 'email' },
  fields: [],
}

const Authors: CollectionConfig = {
  slug: 'authors',
  admin: { useAsTitle: 'name' },
  access: { read: () => true },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'bio', type: 'textarea' },
    // Not exposed to themes (puck-remote.config.ts).
    { name: 'email', type: 'email' },
  ],
}

const Posts: CollectionConfig = {
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  versions: { drafts: true },
  access: {
    // Visitors: published posts. Admin users: everything (the editor previews drafts as them).
    read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'excerpt', type: 'textarea' },
    { name: 'publishedAt', type: 'date' },
    { name: 'status', type: 'select', options: ['published', 'archived'], defaultValue: 'published' },
    { name: 'author', type: 'relationship', relationTo: 'authors' },
    // Not exposed to themes.
    { name: 'secretNotes', type: 'textarea' },
  ],
}

export default buildConfig({
  secret: secret(),
  admin: { user: Users.slug, importMap: { baseDir: path.join(root, 'src') } },
  collections: [Users, Authors, Posts],
  globals: [
    {
      slug: 'site',
      access: { read: () => true },
      fields: [
        { name: 'tagline', type: 'text' },
        { name: 'footer', type: 'text' },
      ],
    },
  ],
  db: sqliteAdapter({ client: { url: `file:${path.join(root, 'data', 'payload.db')}` } }),
  typescript: { outputFile: path.join(root, 'src', 'payload-types.ts') },
  telemetry: false,
  plugins: [
    // Themes and the editor in Payload's admin (/admin/puck-remote), the theme store's collections,
    // and the endpoints they call. The editor previews data as the logged-in user (drafts included).
    puckRemotePlugin({
      // Lazy: puck-remote's config imports this one (through its data source).
      core: () => import('./puck-remote.ts').then((m) => m.remote.core),
      editorUrl: `${EDITOR_ORIGIN}/`,
      previewAs: 'user',
    }),
  ],
})
