/**
 * payloadSource against a real Payload (SQLite): query mapping, per-user access through the
 * request, the default draft rule, anonymous queries, relations and config validation.
 */
import type { NormalizedFind, SourceContext } from '@puck-remote/sdk/host'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadSource, toPayloadWhere } from '../src/source.ts'
import { payloadFixture, type Fixture } from './fixture.ts'

let f: Fixture
beforeAll(async () => {
  f = await payloadFixture()
}, 60_000)
afterAll(() => f?.close())

const q = (o: Partial<NormalizedFind> = {}): NormalizedFind => ({ where: null, sort: { field: 'rank', direction: 'asc' }, limit: 10, page: 1, select: null, depth: 0, ...o })
const ctx = (request: Request | null): SourceContext<true> => ({ request, locale: 'en', signal: new AbortController().signal })
const source = (extra: Partial<Parameters<ReturnType<typeof payloadSource>>[0]> = {}) =>
  payloadSource()({
    payload: () => f.payload,
    collections: {
      posts: { fields: { title: { type: 'text' }, slug: { type: 'text' }, rank: { type: 'number' }, internal: { type: 'text' }, author: { type: 'relation', to: 'authors' } } },
      authors: { fields: { name: { type: 'text' } } },
    },
    globals: { site: { fields: { tagline: { type: 'text' } } } },
    ...extra,
  })
const titles = (r: { docs: Record<string, unknown>[] }) => r.docs.map((d) => d.title)

describe('payloadSource', () => {
  it('declares requireRequest', () => {
    expect(source().requireRequest).toBe(true)
  })

  it('anonymous (no request, or no session): published, public posts only', async () => {
    const s = source()
    expect(titles(await s.collections.posts.find(q(), ctx(null)))).toEqual(['Hello', 'Search me'])
    expect(titles(await s.collections.posts.find(q(), ctx(f.as.anonymous())))).toEqual(['Hello', 'Search me'])
    // Field-level access applies too.
    expect((await s.collections.posts.find(q(), ctx(null))).docs[0].internal).toBeUndefined()
  })

  it('a site member sees what Payload lets them read, without drafts', async () => {
    const r = await source().collections.posts.find(q(), ctx(f.as.member()))
    expect(titles(r)).toEqual(['Hello', 'Members', 'Search me'])
    expect(r.docs[0].internal).toBeUndefined()
  })

  it('an admin user (config.admin.user) reads drafts and admin-only fields, by cookie or API key', async () => {
    for (const request of [f.as.admin(), f.as.apiKey()]) {
      const r = await source().collections.posts.find(q(), ctx(request))
      expect(titles(r)).toEqual(['Hello', 'Members', 'Search me', 'DRAFT: Soon'])
      expect(r.docs[0].internal).toBe('note')
    }
  })

  it('the draft option overrides the default rule', async () => {
    const never = source({ draft: () => false })
    expect(titles(await never.collections.posts.find(q(), ctx(f.as.admin())))).not.toContain('DRAFT: Soon')
  })

  it('maps where, sort, select, limit, page and depth', async () => {
    const s = source()
    const find = (o: Partial<NormalizedFind>) => s.collections.posts.find(q(o), ctx(null))
    expect(titles(await find({ where: { field: 'slug', op: 'equals', value: 'hello' } }))).toEqual(['Hello'])
    expect(titles(await find({ where: { field: 'slug', op: 'in', value: ['hello', 'search'] } }))).toEqual(['Hello', 'Search me'])
    expect(titles(await find({ where: { field: 'title', op: 'contains', value: 'search' } }))).toEqual(['Search me'])
    expect(titles(await find({ where: { field: 'title', op: 'contains', value: null } }))).toEqual(['Hello', 'Search me'])
    expect(titles(await find({ where: { field: 'rank', op: 'gt', value: 1 } }))).toEqual(['Search me'])
    expect(titles(await find({ where: { field: 'rank', op: 'lt', value: 2 } }))).toEqual(['Hello'])
    expect(titles(await find({ where: { or: [{ field: 'slug', op: 'equals', value: 'hello' }, { field: 'rank', op: 'equals', value: 3 }] } }))).toEqual(['Hello', 'Search me'])
    expect(titles(await find({ sort: { field: 'rank', direction: 'desc' } }))).toEqual(['Search me', 'Hello'])
    const paged = await find({ limit: 1, page: 2 })
    expect(titles(paged)).toEqual(['Search me'])
    expect(paged.totalDocs).toBe(2)
    const selected = await find({ select: ['id', 'title'], limit: 1 })
    expect(Object.keys(selected.docs[0]).sort()).toEqual(['id', 'title'])
    expect((await find({ limit: 1 })).docs[0].author).toBe(f.ids.ana)
    expect((await find({ limit: 1, depth: 1 })).docs[0].author).toMatchObject({ name: 'Ana' })
  })

  it('findByID returns null when missing or forbidden, and globals read as the user', async () => {
    const s = source()
    expect(await s.collections.posts.findByID!(String(f.ids.published), { select: null, depth: 0 }, ctx(null))).toMatchObject({ title: 'Hello' })
    expect(await s.collections.posts.findByID!(String(f.ids.draft), { select: null, depth: 0 }, ctx(null))).toBeNull()
    expect(await s.collections.posts.findByID!('999999', { select: null, depth: 0 }, ctx(null))).toBeNull()
    expect(await s.collections.posts.findByID!(String(f.ids.draft), { select: null, depth: 0 }, ctx(f.as.admin()))).toMatchObject({ title: 'DRAFT: Soon' })
    expect(await s.globals.site.get(ctx(null))).toMatchObject({ tagline: 'Hi' })
    // Without drafts, never-published docs stay hidden even when access rules let the user read them.
    expect(await s.collections.posts.findByID!(String(f.ids.draft), { select: null, depth: 0 }, ctx(f.as.member()))).toBeNull()
  })

  it('authenticates once per request', async () => {
    let calls = 0
    const counting = new Proxy(f.payload, { get: (t, k) => (k === 'auth' ? (...a: unknown[]) => (calls++, (t.auth as any)(...a)) : (t as any)[k]) })
    const s = source({ payload: () => counting })
    const request = f.as.admin()
    await Promise.all([s.collections.posts.find(q(), ctx(request)), s.collections.authors.find(q({ sort: null }), ctx(request)), s.globals.site.get(ctx(request))])
    expect(calls).toBe(1)
  })

  it('does not start a query when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(source().collections.posts.find(q(), { request: null, locale: 'en', signal: ac.signal })).rejects.toBeDefined()
  })

  it('rejects declared collections, fields or relations Payload does not have', async () => {
    const bad = (collections: any, globals: any = {}) => payloadSource()({ payload: () => f.payload, collections, globals }).collections
    await expect(Object.values(bad({ nope: { fields: {} } }))[0].find(q({ sort: null }), ctx(null))).rejects.toThrow(/collection "nope" does not exist/)
    await expect(bad({ posts: { fields: { ghost: { type: 'text' } } } }).posts.find(q(), ctx(null))).rejects.toThrow(/field "ghost" does not exist/)
    await expect(bad({ posts: { fields: { author: { type: 'relation', to: 'authors' } } } }).posts.find(q(), ctx(null))).rejects.toThrow(/not an exposed collection/)
    await expect(
      bad({ posts: { fields: { title: { type: 'relation', to: 'authors' } } }, authors: { fields: {} } }).posts.find(q(), ctx(null)),
    ).rejects.toThrow(/not a relation to "authors"/)
  })
})

describe('toPayloadWhere', () => {
  it('drops clauses matching everything', () => {
    expect(toPayloadWhere({ and: [{ field: 'a', op: 'contains', value: null }] })).toBeNull()
    expect(toPayloadWhere({ or: [{ field: 'a', op: 'equals', value: 1 }, { field: 'b', op: 'contains', value: null }] })).toBeNull()
    expect(toPayloadWhere({ and: [{ field: 'a', op: 'gt', value: 1 }, { field: 'b', op: 'contains', value: null }] })).toEqual({ a: { greater_than: 1 } })
  })
})
