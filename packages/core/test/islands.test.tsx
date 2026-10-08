/**
 * Islands: theme client components ("use client" exports) are rendered in the isolate, recorded
 * with JSON props, and swapped into the public page as <ThemeIsland> only through nonce-checked
 * markers. Server rendering never loads the islands bundle.
 */
import { Render } from '@puckeditor/core/rsc'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { preparePage } from '../src/server/public-render.ts'
import { buildRscConfig } from '../src/server/puck-rsc.tsx'
import { testHost } from './helpers.ts'

const errors = vi.fn()
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(errors)
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterAll(() => vi.restoreAllMocks())

const ID = 'blocks/parts/widget.tsx#Widget'
const page = (...props: Record<string, unknown>[]) => ({
  root: { props: {} },
  content: props.map((p, i) => ({ type: 'islander', props: { id: `b${i}`, ...p } })),
})

async function render(pages: Record<string, unknown>) {
  const h = await testHost({ theme: 'evil', pages })
  const p = (await preparePage(h.host, 'home', {}))!
  const html = renderToString(<Render config={buildRscConfig(p.manifest)} data={p.data} metadata={{ rendered: p.rendered, islandsUrl: p.islandsUrl }} />)
  return { h, p, html }
}

describe('islands', () => {
  it('records the island with JSON props and its hydrate mode, and swaps the marker', async () => {
    const { h, p, html } = await render({ home: page({ mode: 'ok' }) })
    const r = p.rendered.b0
    expect(r.ok).toBe(true)
    expect(r.html).toBe(`<div data-puck-island="i0" data-nonce="${r.nonce}"></div>`)
    expect(r.islands).toEqual([{ key: 'i0', id: ID, props: { label: 'hi' }, hydrate: 'idle', html: '<button type="button">hi<!-- --> <!-- -->0</button>' }])
    expect(p.islandsUrl).toBe(`/theme/${p.artifact}/bundle.islands.js`)
    expect(html).toBe(`<div id="root"><div data-puck-island="${ID}" style="display:contents"><button type="button">hi<!-- --> <!-- -->0</button></div></div>`)
    // Server rendering never loads the bundle nor registers shared modules.
    expect((globalThis as Record<string, unknown>).__puckRemoteModules).toBeUndefined()
    await h.close()
  })

  it('fails the block on non-JSON props, children, or too many islands', async () => {
    const { h, p } = await render({ home: page({ mode: 'fn' }, { mode: 'children' }, { mode: 'many', count: 150 }, { mode: 'many', count: 60 }) })
    expect(p.rendered.b0).toMatchObject({ ok: false, islands: [] })
    expect(p.rendered.b1).toMatchObject({ ok: false, islands: [] })
    expect(p.rendered.b2.ok).toBe(true)
    expect(p.rendered.b3).toMatchObject({ ok: false, error: 'invalid-output' }) // 150 + 60 > 200 per page
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/props must be JSON[\s\S]*children cannot be passed[\s\S]*more than 200 islands/)
    await h.close()
  })

  it('a forged island marker (wrong nonce) stays inert; the real one is swapped once', async () => {
    const { h, p, html } = await render({ home: page({ mode: 'forge', guess: 'n0nce-guess' }) })
    expect(p.rendered.b0.islands.map((i) => i.key)).toEqual(['i0'])
    expect(html.match(/data-puck-island="blocks/g)).toHaveLength(1)
    expect(html).toContain('<div data-puck-island="i0" data-nonce="n0nce-guess"></div>')
    await h.close()
  })

  it('pages without islands have no islandsUrl', async () => {
    const { h, p } = await render({ home: { root: { props: {} }, content: [{ type: 'probe', props: { id: 'q' } }] } })
    expect(p.islandsUrl).toBeUndefined()
    await h.close()
  })
})
