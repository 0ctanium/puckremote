/**
 * createProxy routing per origin (D-0282, D-0283): the editor page only at the editor origin's
 * root, admin pages at the host origins' root, both routes hidden everywhere else.
 */
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { createProxy } from '../src/proxy.ts'

const ORIGINS = { host: ['https://admin.example.com'], editor: 'https://editor.example.net' }
// No artifact: cache hints for public pages are skipped.
const artifacts = { readPointer: async () => null, writePointer: async () => {}, list: async () => [], readFile: async () => null, writeArtifact: async () => '' }
const proxy = createProxy({ artifacts, origins: ORIGINS })

const at = (origin: string, path: string) => {
  const u = new URL(origin)
  return proxy(new NextRequest(`${origin}${path}`, { headers: { 'x-forwarded-host': u.host, 'x-forwarded-proto': u.protocol.slice(0, -1) } }))
}
const rewrite = (r: Response) => {
  const to = r.headers.get('x-middleware-rewrite')
  return to ? new URL(to).pathname : null
}

describe('editor origin', () => {
  it('serves the editor page at / only, with the editor CSP', async () => {
    const r = await at(ORIGINS.editor, '/')
    expect(rewrite(r)).toBe('/editor')
    expect(r.headers.get('content-security-policy')).toContain('frame-ancestors https://admin.example.com')
  })

  it('answers 404 everywhere else, /editor included, with the editor headers', async () => {
    for (const p of ['/editor', '/editor/x', '/foo', '/admin', '/cdn/assets/theme.css']) {
      const r = await at(ORIGINS.editor, p)
      expect(r.status, p).toBe(404)
      expect(rewrite(r), p).toBeNull()
      expect(r.headers.get('cache-control'), p).toBe('no-store')
      expect(r.headers.get('content-security-policy'), p).toContain('frame-ancestors https://admin.example.com')
    }
  })

  it("lets Next's own files through", async () => {
    const r = await at(ORIGINS.editor, '/_next/static/chunks/app.js')
    expect(r.status).toBe(200)
    expect(r.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('host (admin) origins', () => {
  it('rewrites every path under /admin', async () => {
    expect(rewrite(await at(ORIGINS.host[0], '/'))).toBe('/admin')
    expect(rewrite(await at(ORIGINS.host[0], '/editor'))).toBe('/admin/editor')
    expect(rewrite(await at(ORIGINS.host[0], '/pages/home'))).toBe('/admin/pages/home')
    // Not the admin prefix: rewritten like any other path.
    expect(rewrite(await at(ORIGINS.host[0], '/administrator'))).toBe('/admin/administrator')
    expect((await at(ORIGINS.host[0], '/')).headers.get('x-frame-options')).toBe('DENY')
  })

  it('redirects old /admin links to the path without the prefix (D-0307)', async () => {
    for (const [from, to] of [['/admin', '/'], ['/admin/', '/'], ['/admin/editor', '/editor'], ['/admin/editor?x=1', '/editor?x=1']]) {
      const r = await at(ORIGINS.host[0], from)
      expect(r.status, from).toBe(307)
      const loc = new URL(r.headers.get('location')!)
      expect(loc.origin, from).toBe(ORIGINS.host[0])
      expect(loc.pathname + loc.search, from).toBe(to)
      expect(r.headers.get('cache-control'), from).toBe('no-store')
      expect(r.headers.get('x-frame-options'), from).toBe('DENY')
    }
  })

  it('leaves the theme route alone (the editor loads theme files from here)', async () => {
    const r = await at(ORIGINS.host[0], '/cdn/bundle.browser.js')
    expect(rewrite(r)).toBeNull()
    expect(r.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('other origins (the public site)', () => {
  it('hides the admin and editor routes', async () => {
    for (const p of ['/admin', '/admin/editor', '/editor', '/editor/x']) {
      const r = await at('https://www.example.com', p)
      expect(r.status, p).toBe(404)
    }
  })

  it('serves everything else as is', async () => {
    const r = await at('https://www.example.com', '/about')
    expect(rewrite(r)).toBeNull()
    expect(r.headers.get('x-middleware-next')).toBe('1')
  })

  it('without origins, /admin is an ordinary route', async () => {
    const plain = createProxy({ artifacts })
    const r = await plain(new NextRequest('https://www.example.com/admin'))
    expect(r.status).toBe(200)
  })
})

describe('cache headers (templates)', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  const tpl = (type: string) => JSON.stringify({ root: { props: {} }, content: [{ type, props: { id: '1' } }] })
  const files: Record<string, string> = { 'templates/home.json': tpl('plain'), 'templates/search.json': tpl('search') }
  const manifest = JSON.stringify({
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
    root: null,
    blocks: { plain: { data: {} }, search: { data: { r: { source: 'host', op: 'find', collection: 'posts', args: { where: { q: { equals: { $query: 'q' } } } } } } } },
  })
  const store = {
    ...artifacts,
    readPointer: async () => 'art-1',
    readFile: async (_id: string, rel: string) => {
      const s = rel === 'manifest.json' ? manifest : files[rel]
      return s === undefined ? null : new TextEncoder().encode(s)
    },
  }
  const site = (p: ReturnType<typeof createProxy>, path: string) => p(new NextRequest(`https://www.example.com${path}`))
  const mapped = createProxy({ artifacts: store }, { template: (pathname) => ({ name: pathname === '/' ? 'home' : pathname.slice(1) }) })

  it('are set only when the app maps paths to templates', async () => {
    expect((await site(createProxy({ artifacts: store }), '/')).headers.get('x-template-cacheable')).toBeNull()
    expect((await site(createProxy({ artifacts: store }, { template: () => null }), '/')).headers.get('x-template-cacheable')).toBeNull()
    expect((await site(mapped, '/')).headers.get('x-template-cacheable')).toBe('true')
  })

  it('a template using URL query params is no-store', async () => {
    const r = await site(mapped, '/search')
    expect(r.headers.get('x-template-cacheable')).toBe('false')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-uncacheable-blocks')).toBe('search')
  })

  it('an unknown template gets no header', async () => {
    expect((await site(mapped, '/nope')).headers.get('x-template-cacheable')).toBeNull()
  })
})
