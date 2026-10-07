/**
 * Data and network tests 7–13.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleResolve } from '../src/server/editor-rpc.ts'
import { HttpSource, isPublicAddress } from '../src/server/query/http-source.ts'
import { QueryError } from '../src/server/query/params.ts'
import { PayloadMock } from '../src/server/query/payload-mock.ts'
import { resolvePageData } from '../src/server/query/resolver.ts'
import { dataConfig, dataDeps, env, OTHER_SECRET, recorder, SECRET_VALUE, startMockApi, testConfig, type MockApi } from './helpers.ts'

let api: MockApi
beforeAll(async () => {
  api = await startMockApi()
})
afterAll(() => api.close())

const fakeDns =
  (table: Record<string, string[]>) =>
  async (host: string) =>
    (table[host] ?? []).map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }))

function http(resolver = fakeDns({})) {
  const cfg = dataConfig(api.origin)
  return new HttpSource({ config: cfg.http, secrets: cfg.secrets, resolver })
}

const blockedWith = async (p: Promise<unknown>, pattern: RegExp) => {
  const e = await p.then(
    () => null,
    (err) => err,
  )
  expect(e).toBeInstanceOf(QueryError)
  expect((e as QueryError).code).toBe('blocked')
  expect((e as Error).message).toMatch(pattern)
}

const get = (origin: string, path = '/x', headers = {}) => ({ origin, path, method: 'GET' as const, params: {}, headers })

describe('7. SSRF protection', () => {
  it('classifies addresses', () => {
    for (const a of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) {
      expect(isPublicAddress(a), a).toBe(false)
    }
    for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(a), a).toBe(true)
  })

  it('blocks private, loopback and link-local IP literals', async () => {
    const h = http()
    await blockedWith(h.fetchJson(get('https://10.0.0.1')), /non-public/)
    await blockedWith(h.fetchJson(get('https://[::1]')), /non-public/)
    await blockedWith(h.fetchJson(get('https://169.254.169.254', '/latest/meta-data')), /non-public/)
    expect(h.outbound).toBe(0)
    await h.close()
  })

  it('blocks a DNS name resolving to a private IP (including mixed answers)', async () => {
    const h = http(fakeDns({ 'evil.test': ['10.0.0.7'], 'api.example.test': ['93.184.216.34', '127.0.0.1'] }))
    await blockedWith(h.fetchJson(get('https://evil.test')), /non-public/)
    await blockedWith(h.fetchJson(get('https://api.example.test')), /non-public/)
    expect(h.outbound).toBe(0)
    await h.close()
  })

  it('re-checks DNS at connect time (pinned lookup defeats rebinding)', async () => {
    let calls = 0
    // First answer (validation) is public, second (connect) flips to loopback.
    const rebinding = async () => [{ address: calls++ === 0 ? '93.184.216.34' : '127.0.0.1', family: 4 as const }]
    const h = http(rebinding)
    await blockedWith(h.fetchJson(get('https://evil.test')), /non-public/)
    expect(calls).toBeGreaterThanOrEqual(2)
    await h.close()
  })

  it('blocks non-allowlisted origins, http, and origin mismatches', async () => {
    const h = http(fakeDns({ 'not-allowed.test': ['93.184.216.34'] }))
    await blockedWith(h.fetchJson(get('https://not-allowed.test')), /not allowlisted/)
    await blockedWith(h.fetchJson({ ...get('https://api.example.test'), path: '//not-allowed.test/x' }), /origin-relative/)
    await h.close()
  })

  it('follows same-origin redirects but blocks redirects to other origins or private hosts', async () => {
    const h = http()
    expect((await h.fetchJson(get(api.origin, '/v1/redirect-same'))).json).toEqual({ hello: 'world', at: 'redirected' })
    await blockedWith(h.fetchJson(get(api.origin, '/v1/redirect-other-origin')), /different origin https:\/\/example.com/)
    await blockedWith(h.fetchJson(get(api.origin, '/v1/redirect-private')), /different origin http:\/\/127.0.0.1/)
    await blockedWith(h.fetchJson(get(api.origin, '/v1/redirect-loop')), /too many redirects/)
    await h.close()
  })

  it('caps response size', async () => {
    const h = http()
    const e = await h.fetchJson(get(api.origin, '/v1/big?size=2000000')).catch((x) => x)
    expect(e).toMatchObject({ code: 'too-large' })
    await h.close()
  })
})

describe('8. secrets', () => {
  it('a $secret never enters the isolate or the logs, but reaches the upstream', async () => {
    const rec = recorder()
    const h = await dataDeps({ mockOrigin: api.origin, rec })
    const before = api.hits.length
    const { byInstance } = await resolvePageData(
      { instances: [{ id: 'e', props: { count: 2, city: '' }, meta: h.deps.manifest.blocks['event-list'] }], env: env(), mode: 'public' },
      h.deps,
    )
    expect(byInstance.get('e')!.events).toMatchObject({ ok: true })
    const hit = api.hits.slice(before).find((x) => x.path === '/v1/events')!
    expect(hit.headers['x-api-key']).toBe(SECRET_VALUE)
    expect(rec.isolateInputs.length).toBeGreaterThan(0) // toRequest + fromResponse ran in the isolate
    expect(rec.isolateInputs.join('\n')).not.toContain(SECRET_VALUE)
    expect(rec.logs.join('\n')).not.toContain(SECRET_VALUE)
    expect(JSON.stringify(Object.fromEntries(byInstance))).not.toContain(SECRET_VALUE)
    await h.close()
  })

  it('a secret bound to origin A is rejected for origin B', async () => {
    const h = http(fakeDns({ 'api.example.test': ['93.184.216.34'] }))
    const e = await h.fetchJson(get('https://api.example.test', '/x', { 'x-api-key': { $secret: 'EVENTS_API_KEY' } })).catch((x) => x)
    expect(e).toMatchObject({ code: 'secret' })
    expect(String(e.message)).not.toContain(SECRET_VALUE)
    const e2 = await h.fetchJson(get(api.origin, '/v1/public', { 'x-api-key': { $secret: 'OTHER_KEY' } })).catch((x) => x)
    expect(e2).toMatchObject({ code: 'secret' })
    expect(String(e2.message)).not.toContain(OTHER_SECRET)
    expect(h.outbound).toBe(0)
    await h.close()
  })
})

describe('9. dedupe', () => {
  it('identical queries across block instances cause one outbound request', async () => {
    const h = await dataDeps({ mockOrigin: api.origin })
    const meta = h.deps.manifest.blocks['event-list']
    const postsMeta = h.deps.manifest.blocks['latest-posts']
    const before = api.hits.filter((x) => x.path === '/v1/events').length
    const { byInstance, stats } = await resolvePageData(
      {
        instances: [
          { id: 'a', props: { count: 3, city: 'paris' }, meta },
          { id: 'b', props: { count: 3, city: 'paris', heading: 'different heading, same query' }, meta },
          { id: 'c', props: { count: 3, city: 'lyon' }, meta },
          { id: 'p1', props: { count: 2 }, meta: postsMeta },
          { id: 'p2', props: { count: 2 }, meta: postsMeta },
        ],
        env: env(),
        mode: 'public',
      },
      h.deps,
    )
    const after = api.hits.filter((x) => x.path === '/v1/events').length
    expect(after - before).toBe(2) // paris once, lyon once
    expect(stats).toMatchObject({ planned: 5, unique: 3, executed: 3 })
    expect(byInstance.get('a')).toEqual(byInstance.get('b'))
    await h.close()
  })
})

describe('10. budget', () => {
  it('queries beyond the static budget degrade in tree order', async () => {
    const cfg = dataConfig(api.origin)
    cfg.budget = { ...cfg.budget, maxQueries: 2 }
    const h = await dataDeps({ mockOrigin: api.origin, config: cfg })
    const meta = h.deps.manifest.blocks['latest-posts']
    const { byInstance, stats } = await resolvePageData(
      {
        instances: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, props: { count: n }, meta })),
        env: env(),
        mode: 'public',
      },
      h.deps,
    )
    expect(byInstance.get('b1')!.posts.ok).toBe(true)
    expect(byInstance.get('b2')!.posts.ok).toBe(true)
    expect(byInstance.get('b3')!.posts).toEqual({ ok: false, error: 'budget' })
    expect(byInstance.get('b4')!.posts).toEqual({ ok: false, error: 'budget' })
    expect(stats.budgetDropped).toBe(2)
    await h.close()
  })

  it('response bytes over budget degrade later blocks deterministically', async () => {
    const cfg = dataConfig(api.origin)
    cfg.budget = { ...cfg.budget, maxResponseBytes: 500 }
    const h = await dataDeps({ mockOrigin: api.origin, config: cfg })
    const meta = h.deps.manifest.blocks['latest-posts']
    const { byInstance } = await resolvePageData(
      { instances: [2, 3, 4].map((n) => ({ id: `b${n}`, props: { count: n }, meta })), env: env(), mode: 'public' },
      h.deps,
    )
    expect(byInstance.get('b2')!.posts.ok).toBe(true)
    expect(byInstance.get('b4')!.posts).toEqual({ ok: false, error: 'budget' })
    await h.close()
  })

  it('a slow upstream hits the page wall-time budget', async () => {
    const cfg = dataConfig(api.origin)
    cfg.budget = { ...cfg.budget, maxWallMs: 200 }
    const h = await dataDeps({ mockOrigin: api.origin, config: cfg })
    const meta = {
      ...h.deps.manifest.blocks['latest-posts'],
      data: { slow: { source: 'http' as const, origin: api.origin, path: '/v1/slow', method: 'GET' as const, params: { ms: 3000 }, headers: {} } },
    }
    const t = performance.now()
    const { byInstance } = await resolvePageData({ instances: [{ id: 's', props: {}, meta }], env: env(), mode: 'public' }, h.deps)
    expect(byInstance.get('s')!.slow).toEqual({ ok: false, error: 'budget' })
    expect(performance.now() - t).toBeLessThan(1500)
    await h.close()
  })
})

describe('11. editor RPC ignores client-supplied specs', () => {
  it('only blockType + props are used; spec/data/mode/query in the body are ignored', async () => {
    const h = await dataDeps({ mockOrigin: api.origin })
    const res = await handleResolve(
      {
        blockType: 'latest-posts',
        props: { count: 2 },
        slug: 'home',
        spec: { source: 'payload', op: 'find', collection: 'users', args: {} },
        data: { posts: { source: 'payload', op: 'find', collection: 'users', args: {} } },
        query: { source: 'http', origin: 'https://169.254.169.254', path: '/' },
        mode: 'public',
      },
      h.deps,
    )
    expect(res.status).toBe(200)
    const posts = res.json.data!.posts as { ok: true; data: { docs: Record<string, unknown>[] } }
    expect(posts.ok).toBe(true)
    expect(posts.data.docs).toHaveLength(2)
    expect(JSON.stringify(res.json)).not.toContain('admin@example.com')
    expect(Object.keys(res.json.data!)).toEqual(['posts'])
    expect((await handleResolve({ blockType: 'nope', props: {} }, h.deps)).status).toBe(404)
    await h.close()
  })
})

describe('12. draft visibility', () => {
  it('drafts appear in editor (draft) mode, never in public renders', async () => {
    const h = await dataDeps({ mockOrigin: api.origin })
    const meta = h.deps.manifest.blocks['latest-posts']
    const pub = await resolvePageData({ instances: [{ id: 'x', props: { count: 12 }, meta }], env: env(), mode: 'public' }, h.deps)
    const draft = await resolvePageData({ instances: [{ id: 'x', props: { count: 12 }, meta }], env: env(), mode: 'draft' }, h.deps)
    const titles = (r: typeof pub) => (r.byInstance.get('x')!.posts as any).data.docs.map((d: any) => d.title).join('|')
    expect(titles(pub)).not.toContain('DRAFT')
    expect(titles(draft)).toContain('DRAFT')
    // Public again after a draft read: the cache must not leak draft data.
    const pub2 = await resolvePageData({ instances: [{ id: 'x', props: { count: 12 }, meta }], env: env(), mode: 'public' }, h.deps)
    expect(titles(pub2)).not.toContain('DRAFT')
    // The editor RPC always uses draft mode.
    const rpc = await handleResolve({ blockType: 'latest-posts', props: { count: 12 } }, h.deps)
    expect(JSON.stringify(rpc.json)).toContain('DRAFT')
    await h.close()
  })
})

describe('13. payload source policy', () => {
  const payload = () => new PayloadMock(testConfig().payload, { collections: { posts: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, title: `t${i}`, _status: 'published', secretNotes: 'x' })), users: [] }, globals: { site: {}, secrets: {} } })

  it('rejects non-allowlisted collections, globals and fields', () => {
    const p = payload()
    expect(() => p.find('users', {}, 'public')).toThrow(/not exposed/)
    expect(() => p.global('secrets')).toThrow(/not exposed/)
    expect(() => p.find('posts', { select: ['secretNotes'] }, 'public')).toThrow(/not exposed/)
    expect(() => p.find('posts', { where: { secretNotes: { equals: 'x' } } }, 'public')).toThrow(/not exposed/)
    expect(() => p.find('posts', { sort: '-_status' }, 'public')).toThrow(/not exposed/)
  })

  it('clamps limit and never returns non-allowlisted fields', () => {
    const p = payload()
    const r = p.find('posts', { limit: 1000 }, 'public')
    expect(r.docs).toHaveLength(12)
    expect(r.limit).toBe(12)
    expect(p.find('posts', { limit: -5 }, 'public').docs).toHaveLength(1)
    expect(Object.keys(r.docs[0]).sort()).toEqual(['id', 'title'])
  })

  it('tag invalidation refreshes cached payload results', async () => {
    const h = await dataDeps({ mockOrigin: api.origin })
    const meta = h.deps.manifest.blocks['latest-posts']
    const run = () => resolvePageData({ instances: [{ id: 'x', props: { count: 1 }, meta }], env: env(), mode: 'public' }, h.deps)
    const first = await run()
    h.deps.payload.upsert('posts', { id: 'new', title: 'Brand new', slug: 'new', publishedAt: '2030-01-01', status: 'published', _status: 'published' })
    expect((await run()).byInstance.get('x')).toEqual(first.byInstance.get('x')) // cached
    expect(h.deps.cache.invalidate('posts')).toBeGreaterThan(0)
    expect(JSON.stringify((await run()).byInstance.get('x'))).toContain('Brand new')
    await h.close()
  })
})
