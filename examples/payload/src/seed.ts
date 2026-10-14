/**
 * `pnpm --filter payload-example seed`: the demo admin user and the same content as examples/app's
 * mock CMS (data/cms.json). Run on an empty database (delete data/payload.db to start over).
 *
 * DEMO ONLY: admin@example.com / admin, API key `dev-api-key` (or PAYLOAD_API_KEY).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getPayload } from 'payload'
import config from './payload.config.ts'

const production = process.env.NODE_ENV === 'production'
const apiKey = process.env.PAYLOAD_API_KEY ?? (production ? null : 'dev-api-key')
if (!apiKey) throw new Error('PAYLOAD_API_KEY is required in production')

const payload = await getPayload({ config })
if ((await payload.count({ collection: 'users' })).totalDocs > 0) {
  console.log('[seed] the database already has users: nothing to do (delete data/payload.db to start over)')
  process.exit(0)
}

const cms = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../app/data/cms.json'), 'utf8'))

await payload.create({ collection: 'users', data: { email: 'admin@example.com', password: 'admin', enableAPIKey: true, apiKey } })

const authors = new Map<string, number>()
for (const a of cms.collections.authors) {
  const doc = await payload.create({ collection: 'authors', data: { name: a.name, bio: a.bio, email: a.email } })
  authors.set(a.id, doc.id)
}
for (const p of cms.collections.posts) {
  const draft = p._status === 'draft'
  await payload.create({
    collection: 'posts',
    draft,
    data: {
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      publishedAt: p.publishedAt,
      status: p.status,
      author: authors.get(p.author),
      secretNotes: p.secretNotes,
      _status: draft ? 'draft' : 'published',
    },
  })
}
await payload.updateGlobal({ slug: 'site', data: cms.globals.site })
console.log(`[seed] ${cms.collections.authors.length} authors, ${cms.collections.posts.length} posts, site global, user admin@example.com`)
process.exit(0)
