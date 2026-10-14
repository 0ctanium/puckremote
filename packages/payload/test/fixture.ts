/**
 * A real Payload on SQLite in a temp dir: `users` (admin, API keys), `members` (another auth
 * collection, site members), `posts` (drafts on; anonymous visitors read published posts only;
 * `internal` readable by users only), `authors` and a `site` global.
 */
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildConfig, getPayload, type Payload } from 'payload'

export interface Fixture {
  payload: Payload
  ids: { ana: string | number; published: string | number; draft: string | number; membersOnly: string | number }
  /** Requests carrying a session (cookie) of the admin user, a member, or an API key. */
  as: { admin: () => Request; member: () => Request; apiKey: () => Request; anonymous: () => Request }
  close: () => Promise<void>
}

let n = 0

export async function payloadFixture(extra: { collections?: any[] } = {}): Promise<Fixture> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-payload-'))
  const config = buildConfig({
    secret: 'test-secret-0123456789',
    db: sqliteAdapter({ client: { url: `file:${path.join(dir, 'db.sqlite')}` }, push: true }),
    telemetry: false,
    admin: { user: 'users' },
    collections: [
      { slug: 'users', auth: { useAPIKey: true }, fields: [] },
      { slug: 'members', auth: true, fields: [] },
      { slug: 'authors', access: { read: () => true }, fields: [{ name: 'name', type: 'text' }, { name: 'email', type: 'text' }] },
      {
        slug: 'posts',
        versions: { drafts: true },
        access: {
          // Anonymous: published, non-members posts only; any logged-in user (admin or member): everything.
          read: ({ req }) => (req.user ? true : { and: [{ _status: { equals: 'published' } }, { membersOnly: { not_equals: true } }] }),
        },
        fields: [
          { name: 'title', type: 'text' },
          { name: 'slug', type: 'text' },
          { name: 'rank', type: 'number' },
          { name: 'membersOnly', type: 'checkbox' },
          { name: 'internal', type: 'text', access: { read: ({ req }) => req.user?.collection === 'users' } },
          { name: 'author', type: 'relationship', relationTo: 'authors' },
        ],
      },
      ...(extra.collections ?? []),
    ],
    globals: [{ slug: 'site', access: { read: () => true }, fields: [{ name: 'tagline', type: 'text' }, { name: 'secret', type: 'text' }] }],
  })
  const payload = await getPayload({ config, key: `puck-remote-test-${process.pid}-${n++}` })
  const admin = await payload.create({ collection: 'users', data: { email: 'admin@example.com', password: 'test-pw', enableAPIKey: true, apiKey: 'key-0123456789' } as never })
  await payload.create({ collection: 'members', data: { email: 'm@example.com', password: 'test-pw' } as never })
  const ana = await payload.create({ collection: 'authors', data: { name: 'Ana', email: 'ana@example.com' } as never })
  const post = (data: Record<string, unknown>, draft = false) => payload.create({ collection: 'posts', data: { author: ana.id, ...data } as never, draft })
  const published = await post({ title: 'Hello', slug: 'hello', rank: 1, internal: 'note', _status: 'published' })
  const membersOnly = await post({ title: 'Members', slug: 'members', rank: 2, membersOnly: true, _status: 'published' })
  await post({ title: 'Search me', slug: 'search', rank: 3, _status: 'published' })
  const draft = await post({ title: 'DRAFT: Soon', slug: 'soon', rank: 4, _status: 'draft' }, true)
  await payload.updateGlobal({ slug: 'site', data: { tagline: 'Hi', secret: 's' } as never })
  void admin

  const login = async (collection: 'users' | 'members', email: string) => {
    const { token } = await payload.login({ collection, data: { email, password: 'test-pw' } })
    return `payload-token=${token}`
  }
  const adminCookie = await login('users', 'admin@example.com')
  const memberCookie = await login('members', 'm@example.com')
  const req = (headers: Record<string, string> = {}) => () => new Request('http://site.test/', { headers })
  return {
    payload,
    ids: { ana: ana.id, published: published.id, draft: draft.id, membersOnly: membersOnly.id },
    as: {
      admin: req({ cookie: adminCookie }),
      member: req({ cookie: memberCookie }),
      apiKey: req({ authorization: 'users API-Key key-0123456789' }),
      anonymous: req(),
    },
    close: async () => {
      await payload.destroy()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
