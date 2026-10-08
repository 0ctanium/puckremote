/**
 * Editor tests 16 and 18 (test 11 lives in data.test.ts). The editor renders the theme's browser
 * bundle as real components (in the editor iframe); the public site renders bundle.js in the
 * isolate. Both must show the same thing.
 */
import { Render, resolveAllData } from '@puckeditor/core/rsc'
import { copyFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildEditorConfig, type ThemeModule } from '../../editor/src/config.tsx'
import { blockDataSchema, resolveBlock } from '../src/server/editor-rpc.ts'
import { collectInstances, RESERVED_DATA_PROP, rewriteMissing, type PageData } from '../src/server/page-tree.ts'
import { stripResolved } from '../src/server/pages.ts'
import { preparePage } from '../src/server/public-render.ts'
import { buildRscConfig } from '../src/server/puck-rsc.tsx'
import { resolvePageData } from '../src/server/query/resolver.ts'
import { buildExample, startMockApi, testHost, type MockApi } from './helpers.ts'

let api: MockApi
let theme: ThemeModule
// Inside the package so the bundle's bare imports (react, @puck-remote/sdk) resolve to the same
// modules as the test's, as the editor's import map does in the browser.
const browserBundle = path.join(import.meta.dirname, `.browser-bundle-${process.pid}.mjs`)

beforeAll(async () => {
  api = await startMockApi()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await copyFile(path.join((await buildExample()).outDir, 'bundle.browser.js'), browserBundle)
  theme = (await import(/* @vite-ignore */ pathToFileURL(browserBundle).href)).default
})
afterAll(async () => {
  await rm(browserBundle, { force: true })
  await api.close()
})

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

const ctx = (assetBase: string) => ({
  isEditing: false,
  locale: 'en',
  nonce: '',
  page: { slug: 'home' },
  site: { name: 'POC Site' },
  assetUrl: (p: string) => assetBase + p,
  assets: { script() {}, style() {} },
  head: { title() {}, meta() {} },
})

/** React text-node separators (<!-- -->) and isolate slot wrappers differ by construction; nothing else may. */
const normalize = (html: string) => html.replace(/<!-- -->/g, '').replace(/<small class="t-edit-hint">[^<]*<\/small>/g, '')

describe('16. parity: the editor shows exactly what the public site renders', () => {
  it('whole page: browser components with Puck slots equal the public isolate render', async () => {
    const h = await testHost({ theme: 'example', mockOrigin: api.origin, pages: { home: PAGE } })
    const { manifest } = h.host.store.get()
    const pub = (await preparePage(h.host, 'home', {}))!
    const publicHtml = renderToString(<Render config={buildRscConfig(manifest)} data={pub.data} metadata={{ rendered: pub.rendered }} />)

    // Editor state: page data with __data from resolveData (public mode, to compare like for like).
    const data = rewriteMissing(PAGE, manifest)
    const session = await h.host.store.get().runtime.session()
    const instances = collectInstances(data, manifest)
    const { byInstance } = await resolvePageData(
      { instances, env: { page: { slug: 'home', locale: 'en' }, site: h.host.config.site, query: {} }, mode: 'public' },
      { manifest, config: h.host.config, source: h.host.source, http: h.host.http, session: async () => session },
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
    const editorConfig = buildEditorConfig(manifest, theme, { ctx: ctx(`/theme/${pub.artifact}/assets/`), resolve: async () => ({}) })
    const editorHtml = renderToString(<Render config={editorConfig} data={withData as any} />)
    expect(normalize(editorHtml)).toBe(normalize(publicHtml))
    expect(publicHtml).toContain('Puck meetup')
    await h.close()
  })
})

describe('18. resolveData output never persists', () => {
  it('Puck merges resolveData output into page data (finding); writePage strips it', async () => {
    const h = await testHost({ theme: 'example', mockOrigin: api.origin, pages: {} })
    const { manifest, id } = h.host.store.get()
    const deps = { manifest, config: h.host.config, source: h.host.source, http: h.host.http, site: h.host.config.site, session: () => h.host.store.get().runtime.session() }
    const editorConfig = buildEditorConfig(manifest, theme, {
      ctx: ctx('/theme/x/assets/'),
      resolve: async (block, props) => (await resolveBlock(blockDataSchema.parse({ block, props, slug: 'home' }), deps)).data,
    })
    // Exactly what the editor holds after resolveData ran for every block (incl. nested slots).
    const resolved = (await resolveAllData(PAGE as any, editorConfig)) as unknown as PageData
    const json = JSON.stringify(resolved)
    expect(json).toContain(`"${RESERVED_DATA_PROP}"`) // Puck stores it in props…
    expect(json).toContain('"readOnly"') // …and marks it read-only
    expect(json).toContain('DRAFT: Unannounced') // editor data is draft-mode data
    const nested = (resolved.content[0].props.content as any)[0].props.content[0]
    expect(nested.props[RESERVED_DATA_PROP]).toBeDefined() // resolveAllData reaches slot content

    const { writePage, readPage } = await import('../src/server/pages.ts')
    const w = await writePage(h.host.config.artifacts, id, 'home', resolved)
    const raw = new TextDecoder().decode((await h.host.config.artifacts.readFile(w.id, 'pages/home.json'))!)
    for (const s of [raw, JSON.stringify(stripResolved(resolved))]) {
      expect(s).not.toContain(RESERVED_DATA_PROP)
      expect(s).not.toContain('readOnly')
      expect(s).not.toContain('DRAFT')
    }
    const manifestFiles = JSON.parse(new TextDecoder().decode((await h.host.config.artifacts.readFile(w.id, 'manifest.json'))!)).files
    const stored = await readPage(h.host.config.artifacts, w.id, { files: manifestFiles }, 'home')
    // Everything else survives (Puck also normalises: empty slot arrays, root id/type, zones).
    expect(stored).toEqual(JSON.parse(JSON.stringify(stripResolved(resolved))))
    expect((stored!.content[0].props.content as any)[0].props.content[0].props.heading).toBe('Nested')
    await h.close()
  })
})
