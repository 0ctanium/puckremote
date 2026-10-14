/**
 * A mock CMS data source: in-memory collections loaded from JSON. Stands in for any real
 * backend (Payload, a SQL database, a headless CMS API…) behind the host DataSource contract.
 *
 * It only implements storage semantics: filtering, sorting, paging, relation population and
 * the public/draft visibility rule. Field exposure, operator allowlists, limit/depth clamping
 * and output projection are enforced by the host core from the policy declared below.
 */
import { readFileSync } from 'node:fs'
import { defineCollection, defineDataSource, defineGlobal, type NormalizedFind, type NormalizedWhere, type RawDoc, type SourceContext } from '@puck-remote/sdk/host'

export interface Author {
  id: string
  name: string
  bio: string
}

export interface Post {
  id: string
  title: string
  slug: string
  excerpt: string
  publishedAt: string
  status: 'published' | 'archived'
  author: Author | string
}

export interface Site {
  tagline: string
  footer: string
}

export interface MockData {
  collections: Record<string, RawDoc[]>
  globals: Record<string, RawDoc>
}

function matches(doc: RawDoc, w: NormalizedWhere | null): boolean {
  if (!w) return true
  if ('and' in w) return w.and.every((c) => matches(doc, c))
  if ('or' in w) return w.or.some((c) => matches(doc, c))
  const v = doc[w.field]
  switch (w.op) {
    case 'equals':
      return v === w.value
    case 'in':
      return Array.isArray(w.value) && w.value.includes(v)
    case 'contains':
      // A null param (e.g. a missing ?q=) matches everything, like an empty search box.
      return w.value === null || (typeof v === 'string' && typeof w.value === 'string' && v.toLowerCase().includes(w.value.toLowerCase()))
    case 'gt':
      return (v as never) > (w.value as never)
    case 'lt':
      return (v as never) < (w.value as never)
  }
}

export interface MockCmsOptions {
  dataFile?: string
  data?: MockData
  /**
   * Who may read draft docs (`_status: 'draft'`), e.g. the app's admin-session check. Given, the
   * source declares `requireRequest` (it receives each query's request; templates running its
   * queries are not cacheable). Without it, or without a request, drafts are never returned.
   */
  canReadDrafts?: (request: Request) => boolean | Promise<boolean>
}

export function mockCms(opts: MockCmsOptions) {
  const data: MockData = opts.data ? structuredClone(opts.data) : JSON.parse(readFileSync(opts.dataFile!, 'utf8'))
  const all = (c: string) => data.collections[c] ?? []
  const { canReadDrafts } = opts
  // Visibility is a storage concern: drafts only for requests the app lets read them.
  const draftsFor = async (ctx: SourceContext<boolean>) => !!canReadDrafts && 'request' in ctx && !!ctx.request && (await canReadDrafts(ctx.request))
  const visible = (doc: RawDoc, drafts: boolean) => drafts || doc._status !== 'draft'

  const populate = (doc: RawDoc, depth: number): RawDoc => {
    if (depth < 1 || typeof doc.author !== 'string') return doc
    const author = all('authors').find((a) => a.id === doc.author)
    return author ? { ...doc, author } : doc
  }

  const findIn = (collection: string) => async (q: NormalizedFind, ctx: SourceContext<boolean>) => {
    const drafts = await draftsFor(ctx)
    let docs = all(collection).filter((d) => visible(d, drafts) && matches(d, q.where))
    if (q.sort) {
      const { field, direction } = q.sort
      const dir = direction === 'desc' ? -1 : 1
      docs = [...docs].sort((a, b) => ((a[field] as string) > (b[field] as string) ? dir : (a[field] as string) < (b[field] as string) ? -dir : 0))
    }
    const page = docs.slice((q.page - 1) * q.limit, q.page * q.limit)
    return { docs: page.map((d) => populate(d, q.depth)), totalDocs: docs.length }
  }

  const byId = (collection: string) => async (id: string, q: Pick<NormalizedFind, 'depth'>, ctx: SourceContext<boolean>) => {
    const doc = all(collection).find((d) => d.id === id)
    return doc && visible(doc, await draftsFor(ctx)) ? populate(doc, q.depth) : null
  }

  return defineDataSource({
    name: 'mock-cms',
    requireRequest: !!canReadDrafts,
    collections: {
      posts: defineCollection<Post, boolean>()({
        fields: {
          title: { type: 'text' },
          slug: { type: 'text', filter: ['equals', 'in'] },
          excerpt: { type: 'text', filter: false, sort: false },
          publishedAt: { type: 'date', filter: ['gt', 'lt', 'equals'] },
          status: { type: 'text', filter: ['equals', 'in'] },
          author: { type: 'relation', to: 'authors', filter: ['equals', 'in'] },
        },
        limits: { default: 10, max: 12, maxDepth: 1 },
        find: findIn('posts'),
        findByID: byId('posts'),
      }),
      authors: defineCollection<Author, boolean>()({
        // `email` exists in storage but is not exposed: never selectable or returned.
        fields: { name: { type: 'text' }, bio: { type: 'text', filter: false, sort: false } },
        limits: { default: 10, max: 50 },
        find: findIn('authors'),
        findByID: byId('authors'),
      }),
    },
    globals: {
      site: defineGlobal<Site, boolean>()({
        fields: { tagline: { type: 'text' }, footer: { type: 'text' } },
        get: async () => data.globals.site ?? null,
      }),
    },
    /** Test/demo helper standing in for "content changed in the CMS". */
    admin: {
      upsert(collection: string, doc: RawDoc) {
        const list = (data.collections[collection] ??= [])
        const i = list.findIndex((d) => d.id === doc.id)
        if (i >= 0) list[i] = doc
        else list.push(doc)
      },
    },
  })
}

/** The configured source's type. Themes register it to get typed find()/findByID()/global(). */
export type MockCms = ReturnType<typeof mockCms>
