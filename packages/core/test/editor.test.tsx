/**
 * Editor tests 16 and 18 (test 11 lives in data.test.ts).
 */
import { Render, resolveAllData } from '@puckeditor/core/rsc'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildEditorConfig, type EditorDeps } from '../src/editor/config.tsx'
import { handleResolve } from '../src/server/editor-rpc.ts'
import { collectInstances, RESERVED_DATA_PROP, type PageData } from '../src/server/page-tree.ts'
import { stripResolved, writePage } from '../src/server/pages.ts'
import { preparePage, rewriteMissing } from '../src/server/public-render.ts'
import { buildRscConfig } from '../src/server/puck-rsc.tsx'
import { resolvePageData } from '../src/server/query/resolver.ts'
import { renderInIsolate } from '../src/server/render.ts'
import { buildExample, ctx, newRunner, startMockApi, testHost, type MockApi } from './helpers.ts'

let api: MockApi
beforeAll(async () => {
  api = await startMockApi()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(() => api.close())

/** Stand-in for the editor's browser realm: the same bundle.js evaluated in a separate JS realm. TEST ONLY. */
function browserRealm(bundle: string): NonNullable<EditorDeps['render']> {
  const realm = vm.createContext({})
  vm.runInContext(bundle, realm)
  return (realm as any).__render
}

const item = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } })
const PAGE: PageData = {
  root: { props: { title: 'Parity', theme: 'light' } },
  content: [
    item('hero', 'hero-1', {
      title: 'Hero',
      align: 'center',
      showCta: true,
      cta: { href: '/x', label: 'Go' },
      content: [item('card', 'card-1', { title: 'Card', content: [item('latest-posts', 'lp-1', { heading: 'Nested', count: 2 })] })],
    }),
    item('latest-posts', 'lp-2', { heading: 'Top', count: 3, layout: 'grid', columns: 3, items: [{ title: 'Pinned' }] }),
    item('event-list', 'ev-1', { count: 3, city: 'paris' }),
  ],
}

describe('16. parity: editor and public render the same HTML for the same (props, data, ctx)', () => {
  it('raw block HTML from the isolate equals the browser-realm bundle output, for every block', async () => {
    const { bundle, manifest } = await buildExample()
    const runner = newRunner(bundle)
    const session = await runner.session()
    const browser = browserRealm(bundle)
    const data = { posts: { ok: true, data: { docs: [{ title: 'A', slug: 'a' }], totalDocs: 1, limit: 1 } }, events: { ok: true, data: [{ id: 'e', title: 'E', date: '2026-01-01', city: 'paris' }] }, results: { ok: false, error: 'x' }, site: { ok: true, data: { tagline: 't', footer: 'f' } } }
    for (const [name, meta] of [...Object.entries(manifest.blocks), ['root', manifest.root]] as [string, any][]) {
      const kind = name === 'root' ? 'root' : 'block'
      const props = { ...meta.defaultProps, id: 'x', title: 'T <script>alert(1)</script>' }
      const c = ctx({ nonce: 'abc123' })
      const iso = await renderInIsolate(session, kind, name, props, data, c)
      const br = JSON.parse(browser(kind, name, JSON.stringify(props), JSON.stringify(data), JSON.stringify(c)))
      expect(iso.ok, name).toBe(true)
      if (iso.ok) {
        expect(br.html, name).toBe(iso.html)
        expect(br.effects, name).toEqual(iso.effects)
      }
    }
    session.release()
    runner.dispose()
  })

  it('a whole page through the editor config equals the public RSC render', async () => {
    const h = await testHost({ theme: 'example', mockOrigin: api.origin, pages: { home: PAGE } })
    const { manifest, bundle } = { manifest: h.host.store.get().manifest, bundle: h.host.store.get().bundle }

    // Public path.
    const pub = (await preparePage(h.host, 'home', {}))!
    const publicHtml = renderToString(<Render config={buildRscConfig(manifest)} data={pub.data} metadata={{ rendered: pub.rendered }} />)

    // Editor path: same data (public mode for comparability) placed in __data, as resolveData would.
    const data = rewriteMissing(PAGE, manifest)
    const session = await h.host.store.get().runtime.session()
    const { byInstance } = await resolvePageData(
      { instances: collectInstances(data, manifest), env: { page: { slug: 'home', locale: 'en' }, site: h.host.config.site, query: {} }, mode: 'public' },
      { manifest, config: h.host.config, source: h.host.source, http: h.host.http, cache: h.host.cache, session: async () => session },
    )
    session.release()
    const withData = JSON.parse(JSON.stringify(data)) as PageData
    const inject = (items: any[]) =>
      items.forEach((it) => {
        it.props[RESERVED_DATA_PROP] = byInstance.get(it.props.id)
        for (const v of Object.values(it.props)) if (Array.isArray(v) && v[0]?.type) inject(v)
      })
    inject(withData.content)
    ;(withData.root.props as any)[RESERVED_DATA_PROP] = byInstance.get('root')
    const editorConfig = buildEditorConfig(manifest, {
      version: 1,
      assetBase: '/theme/v1/assets/',
      slug: 'home',
      site: h.host.config.site,
      render: browserRealm(bundle),
      resolve: async () => ({}),
      newNonce: () => Math.random().toString(16).slice(2).padEnd(32, '0'),
      isEditing: false,
    })
    const editorHtml = renderToString(<Render config={editorConfig} data={withData as any} />)
    expect(editorHtml).toBe(publicHtml)
    expect(publicHtml).toContain('Puck meetup')
    await h.close()
  })
})

describe('18. resolveData output never persists', () => {
  it('Puck merges resolveData output into page data (finding); the save path strips it', async () => {
    const h = await testHost({ theme: 'example', mockOrigin: api.origin, pages: {} })
    const { manifest } = h.host.store.get()
    const deps = {
      manifest,
      config: h.host.config,
      source: h.host.source,
      http: h.host.http,
      cache: h.host.cache,
      site: h.host.config.site,
      session: () => h.host.store.get().runtime.session(),
    }
    const editorConfig = buildEditorConfig(manifest, {
      version: 1,
      assetBase: '/theme/v1/assets/',
      slug: 'home',
      site: h.host.config.site,
      render: null,
      newNonce: () => 'n',
      resolve: async (blockType, props) => (await handleResolve({ blockType, props, slug: 'home' }, deps)).json.data!,
    })
    // Exactly what the editor holds after resolveData ran for every block (incl. nested slots).
    const resolved = (await resolveAllData(PAGE as any, editorConfig)) as unknown as PageData
    const json = JSON.stringify(resolved)
    expect(json).toContain(`"${RESERVED_DATA_PROP}"`) // Puck stores it in props…
    expect(json).toContain('"readOnly"') // …and marks it read-only
    expect(json).toContain('DRAFT: Unannounced') // editor data is draft-mode data
    const nested = (resolved.content[0].props.content as any)[0].props.content[0]
    expect(nested.props[RESERVED_DATA_PROP]).toBeDefined() // resolveAllData reaches slot content

    // Save path (POST /api/pages → writePage) strips it everywhere.
    const saved = await writePage(h.host.config.pages, 'home', resolved)
    const onDisk = await readFile(path.join(h.pagesDir, 'home.json'), 'utf8')
    for (const s of [JSON.stringify(saved), onDisk, JSON.stringify(stripResolved(resolved))]) {
      expect(s).not.toContain(RESERVED_DATA_PROP)
      expect(s).not.toContain('readOnly')
      expect(s).not.toContain('DRAFT')
    }
    // Everything else survives (Puck also normalises: empty slot arrays, root id/type, zones).
    expect(JSON.parse(onDisk)).toEqual(JSON.parse(JSON.stringify(stripResolved(resolved))))
    expect(JSON.parse(onDisk).content[0].props.content[0].props.content[0].props.heading).toBe('Nested')
    await h.close()
  })
})
