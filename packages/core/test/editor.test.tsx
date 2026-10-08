/**
 * Editor tests 16 and 18 (test 11 lives in data.test.ts).
 */
import { Render, resolveAllData } from '@puckeditor/core/rsc'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildEditorConfig } from '../src/editor/config.tsx'
import { createRemoteRenderer, type RenderItem } from '../src/editor/remote-render.ts'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { createCore, devAllowAll } from '../src/index.ts'
import { renderProps } from '../src/server/page-tree.ts'
import { handleResolve } from '../src/server/editor-rpc.ts'
import { collectInstances, RESERVED_DATA_PROP, type PageData } from '../src/server/page-tree.ts'
import { stripResolved, writePage } from '../src/server/pages.ts'
import { preparePage, rewriteMissing } from '../src/server/public-render.ts'
import { buildRscConfig } from '../src/server/puck-rsc.tsx'
import { resolvePageData } from '../src/server/query/resolver.ts'
import { dataConfig, startMockApi, testHost, type MockApi } from './helpers.ts'

let api: MockApi
beforeAll(async () => {
  api = await startMockApi()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(() => api.close())

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

/** Nonces differ per render by design; isEditing-only markup is the theme's choice. Normalize both. */
const normalize = (html: string) => html.replace(/ data-nonce="[0-9a-f]{32}"/g, '').replace(/<small class="t-edit-hint">[^<]*<\/small>/g, '')

describe('16. parity: the editor shows exactly what the public site renders', () => {
  it('per block: /blocks/render HTML equals the public render for the same (props, data)', async () => {
    const h = await testHost({ theme: 'example', mockOrigin: api.origin, pages: { home: PAGE } })
    const core = createCore({ ...dataConfig(api.origin), id: `parity-${process.pid}`, artifacts: fsArtifactStore({ dir: h.artifactsDir }), pages: h.host.config.pages, source: h.host.config.source, auth: devAllowAll() })
    const { manifest } = (await core.host()).store.get()
    ;(await core.host()).store.get().manifest.adapters.events.origin = api.origin

    const pub = (await core.preparePage('home'))!
    // The same props + data the editor would hold after resolveData (public mode, to compare like for like).
    const hh = await core.host()
    const session = await hh.store.get().runtime.session()
    const instances = collectInstances(pub.data, manifest)
    const { byInstance } = await resolvePageData(
      { instances, env: { page: { slug: 'home', locale: 'en' }, site: core.config.site, query: {} }, mode: 'public' },
      { manifest, config: core.config, source: hh.source, http: hh.http, cache: hh.cache, session: async () => session },
    )
    session.release()
    const items = instances.map((i) => ({ key: i.id, kind: i.kind, name: i.name, props: renderProps(i.props, i.meta), data: byInstance.get(i.id) ?? {} }))
    const res = await core.handleApi(new Request('http://x.test/api/blocks/render', { method: 'POST', headers: { 'x-puck-remote': '1', 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'home', items }) }))
    expect(res.status).toBe(200)
    const { results } = await res.json()
    for (const i of instances) {
      expect(results[i.id].ok, i.name).toBe(true)
      expect(normalize(results[i.id].html), i.name).toBe(normalize(pub.rendered[i.id].html))
    }
    ;(await core.host()).store.close()
    await h.close()
  })

  it('whole page: the editor config (server-rendered blocks + client slot swap) equals the public RSC render', async () => {
    const h = await testHost({ theme: 'example', mockOrigin: api.origin, pages: { home: PAGE } })
    const { manifest } = h.host.store.get()
    const pub = (await preparePage(h.host, 'home', {}))!
    const publicHtml = renderToString(<Render config={buildRscConfig(manifest)} data={pub.data} metadata={{ rendered: pub.rendered }} />)

    // Editor state: page data with __data from resolveData, renderer cache primed with the server's
    // render results (exactly what the canvas shows once the batch returns).
    const data = rewriteMissing(PAGE, manifest)
    const session = await h.host.store.get().runtime.session()
    const instances = collectInstances(data, manifest)
    const { byInstance } = await resolvePageData(
      { instances, env: { page: { slug: 'home', locale: 'en' }, site: h.host.config.site, query: {} }, mode: 'public' },
      { manifest, config: h.host.config, source: h.host.source, http: h.host.http, cache: h.host.cache, session: async () => session },
    )
    session.release()
    const renderer = createRemoteRenderer({ apiRoute: '/api', slug: 'home', fetch: async () => { throw new Error('not used') } })
    for (const i of instances) {
      // Puck's Render adds id/title to root props; prime with exactly what RemoteBlock will request.
      const props = i.kind === 'root' ? { ...i.props, title: i.props.title ?? '', id: 'puck-root' } : i.props
      const item: RenderItem = { kind: i.kind, name: i.name, props: renderProps(props, i.meta), data: byInstance.get(i.id) ?? {} }
      const r = pub.rendered[i.id]
      renderer.prime(item, { ok: true, html: r.html, nonce: r.nonce, effects: [] })
    }
    const withData = JSON.parse(JSON.stringify(data)) as PageData
    const inject = (items: any[]) =>
      items.forEach((it) => {
        it.props[RESERVED_DATA_PROP] = byInstance.get(it.props.id)
        for (const v of Object.values(it.props)) if (Array.isArray(v) && v[0]?.type) inject(v)
      })
    inject(withData.content)
    ;(withData.root.props as any)[RESERVED_DATA_PROP] = byInstance.get('root')
    const editorConfig = buildEditorConfig(manifest, { version: 1, slug: 'home', site: h.host.config.site, renderer, resolve: async () => ({}) })
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
      slug: 'home',
      site: h.host.config.site,
      renderer: createRemoteRenderer({ apiRoute: '/api', slug: 'home' }),
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
