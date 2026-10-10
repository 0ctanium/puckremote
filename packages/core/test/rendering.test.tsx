/**
 * Rendering tests 14, 15, 17 (and the page-level part of 2): the real public pipeline —
 * prepareTemplate (isolate) → Puck RSC <Render> → HTML.
 */
import { Render } from '@puckeditor/core/rsc'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareTemplate } from '../src/server/public-render.ts'
import { buildRscConfig } from '../src/server/puck-rsc.tsx'
import { startMockApi, testHost, type MockApi } from './helpers.ts'

let api: MockApi
beforeAll(async () => {
  api = await startMockApi()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterAll(() => api.close())

async function renderPublic(h: Awaited<ReturnType<typeof testHost>>, slug: string, query: Record<string, string> = {}) {
  const page = await prepareTemplate(h.host, slug, { query })
  if (!page) throw new Error('page not found')
  const html = renderToString(<Render config={buildRscConfig(h.host.store.get().manifest)} data={page.data} metadata={{ rendered: page.rendered }} />)
  return { page, html }
}

const item = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } })

describe('14. forged slot markers', () => {
  it('markers without the per-render nonce are never swapped', async () => {
    const forgedHtml = '<div data-puck-slot="content" data-nonce="guess"></div>'
    const h = await testHost({
      theme: 'evil',
      pages: {
        home: {
          root: { props: {} },
          content: [item('forger', 'f1', { text: forgedHtml, guess: 'n0nce-guess', content: [item('probe', 'child')] })],
        },
      },
    })
    const { html, page } = await renderPublic(h, 'home')
    // The real <Slot/> appears twice in the forger's output, but a slot is swapped at most once:
    // exactly one copy of the child block is rendered.
    expect(html.match(/id="probe"/g)).toHaveLength(1)
    // Text content is escaped by React, raw HTML forgery stays an inert empty div.
    expect(html).toContain('&lt;div data-puck-slot=&quot;content&quot;')
    expect(html).toContain('data-nonce="guess"')
    expect(html).toContain('data-nonce="n0nce-guess"')
    // The nonce actually used is fresh per render and never equals a user-supplied value.
    expect(page.rendered.f1.nonce).toMatch(/^[0-9a-f]{32}$/)
    await h.close()
  })
})

describe('15. slots render real child blocks', () => {
  it('hero → card → latest-posts (all sandboxed) render nested, with data, through root', async () => {
    const h = await testHost({
      theme: 'example',
      mockOrigin: api.origin,
      pages: {
        home: {
          root: { props: { title: 'Hello', theme: 'dark' } },
          content: [
            item('hero', 'hero-1', {
              title: 'Top',
              content: [item('card', 'card-1', { title: 'Inner card', content: [item('latest-posts', 'lp-1', { heading: 'Deep posts', count: 2 })] })],
            }),
            item('event-list', 'ev-1', { count: 2, city: 'paris' }),
          ],
        },
      },
    })
    const { html, page } = await renderPublic(h, 'home')
    expect(page.stats.failures).toBe(0)
    // Nesting order: root > main > hero > card > latest-posts
    const iRoot = html.indexOf('class="t-main"')
    const iHero = html.indexOf('t-hero')
    const iCard = html.indexOf('Inner card')
    const iPosts = html.indexOf('Deep posts')
    expect(iRoot).toBeGreaterThan(-1)
    expect(iRoot).toBeLessThan(iHero)
    expect(iHero).toBeLessThan(iCard)
    expect(iCard).toBeLessThan(iPosts)
    expect(html).toContain('Sandboxing React with isolated-vm') // host data source
    expect(html).toContain('Puck meetup') // adapter data via mock API
    expect(html).toContain('data-theme="dark"')
    expect(html).not.toMatch(/data-puck-slot="(content|children)" data-nonce="[0-9a-f]{32}"/) // all real markers swapped
    // Asset URLs are versioned by content, not by artifact (D-0262).
    const v = (f: string) => page.manifest.files[f].slice(0, 12)
    expect(page.head.styles).toEqual([`/cdn/assets/theme.css?v=${v('assets/theme.css')}`])
    expect(page.head.scripts[0]).toMatchObject({ url: `/cdn/assets/enhance.js?v=${v('assets/enhance.js')}`, defer: true })
    await h.close()
  })
})

describe('17. resilience', () => {
  it('unknown block type → explicit fallback; nested known blocks inside unknown ones are skipped', async () => {
    const h = await testHost({
      theme: 'example',
      mockOrigin: api.origin,
      pages: {
        home: {
          root: { props: {} },
          content: [item('removed-block', 'x1', { foo: 1, content: [item('card', 'c-inside-missing')] }), item('card', 'c1', { title: 'Still here' })],
        },
      },
    })
    const { html, page } = await renderPublic(h, 'home')
    expect(html).toContain('data-missing-block="removed-block"')
    expect(html).toContain('Still here')
    expect(page.data.content[0]).toMatchObject({ type: '__missing', props: { originalType: 'removed-block' } })
    await h.close()
  })

  it('removed fields in props and missing fields do not crash', async () => {
    const h = await testHost({
      theme: 'example',
      mockOrigin: api.origin,
      pages: {
        home: {
          root: { props: {} },
          content: [
            item('card', 'c1', { title: 'Has a stale prop', subtitleThatNoLongerExists: 'x', tone: 'plain' }),
            item('latest-posts', 'lp', {}), // every field missing → defaults
            item('hero', 'h1', { title: 'Hero without slot prop' }), // slot prop missing entirely
          ],
        },
      },
    })
    const { html, page } = await renderPublic(h, 'home')
    expect(page.stats.failures).toBe(0)
    expect(html).toContain('Has a stale prop')
    expect(html).toContain('Latest')
    expect(html).toContain('Hero without slot prop')
    await h.close()
  })

  it('2 (page level): an infinite loop in one block leaves the rest of the page rendering', async () => {
    const h = await testHost({
      theme: 'evil',
      pages: { home: { root: { props: {} }, content: [item('spin', 's1'), item('memory-hog', 'm1'), item('thrower', 't1'), item('probe', 'p1')] } },
    })
    const { html, page } = await renderPublic(h, 'home')
    expect(page.stats.failures).toBe(3)
    expect(html).toContain('data-block-error="spin"')
    expect(html).toContain('data-block-error="memory-hog"')
    expect(html).toContain('data-block-error="thrower"')
    expect(html).toContain('id="probe"') // rendered after the isolate was recreated
    expect(html).toContain('id="root"')
    await h.close()
  })
})

describe('cacheability', () => {
  it('templates with $query blocks are flagged uncacheable and receive URL params', async () => {
    const h = await testHost({
      theme: 'example',
      mockOrigin: api.origin,
      pages: {
        search: { root: { props: {} }, content: [item('search-results', 's1')] },
        home: { root: { props: {} }, content: [item('card', 'c1')] },
      },
    })
    const { page, html } = await renderPublic(h, 'search', { q: 'nonces' })
    expect(page.cacheable).toBe(false)
    expect(page.uncacheableBlocks).toEqual(['search-results'])
    expect(html).toContain('Slots and nonces')
    expect(html).not.toContain('Declarative data')
    expect((await renderPublic(h, 'home', { q: 'x' })).page.cacheable).toBe(true)
    await h.close()
  })
})
