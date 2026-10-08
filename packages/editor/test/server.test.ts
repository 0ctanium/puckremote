/** The editor server: static files, runtime config, security headers. Needs the built package (pnpm build). */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CONFIG_ELEMENT_ID } from '../src/protocol.ts'
import { createEditorHandler } from '../src/server.ts'

const ADMIN = 'https://admin.example.com'
const get = (h: (r: Request) => Promise<Response>, path: string, init?: RequestInit) => h(new Request(`https://editor.example.net${path}`, init))

describe('createEditorHandler', () => {
  const handler = createEditorHandler({ adminOrigins: [`${ADMIN}/`] })

  it('serves the page with the admin origins injected as a JSON data block', async () => {
    for (const p of ['/', '/index.html']) {
      const r = await get(handler, p)
      expect(r.status, p).toBe(200)
      expect(r.headers.get('content-type')).toContain('text/html')
      expect(r.headers.get('cache-control')).toBe('no-store')
      const html = await r.text()
      expect(html).toContain(`<script type="application/json" id="${CONFIG_ELEMENT_ID}">{"adminOrigins":["${ADMIN}"]}</script>`)
      expect(html).not.toContain('<!--puck-remote-editor-config-->')
    }
  })

  it('escapes the config so it cannot close the script element', async () => {
    // Origins are normalized by URL first, so build the block from a raw value to check escaping.
    const h = createEditorHandler({ adminOrigins: ['https://a.test'] })
    const html = await (await get(h, '/')).text()
    const block = html.split(`id="${CONFIG_ELEMENT_ID}">`)[1].split('</script>')[0]
    expect(JSON.parse(block)).toEqual({ adminOrigins: ['https://a.test'] })
  })

  it('sends the editor CSP: import map by hash, framed by admin origins only, no cookies', async () => {
    const r = await get(handler, '/')
    const html = await r.text()
    const importMap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]
    const hash = `sha256-${createHash('sha256').update(importMap).digest('base64')}`
    const csp = r.headers.get('content-security-policy')!
    expect(csp).toContain(`script-src 'self' '${hash}' ${ADMIN}`)
    expect(csp).toContain(`frame-ancestors ${ADMIN}`)
    expect(csp).toContain("connect-src 'self'")
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('set-cookie')).toBeNull()
  })

  it('serves the hashed assets and vendor shims referenced by the page, immutable', async () => {
    const html = await (await get(handler, '/')).text()
    const urls = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g), ...html.matchAll(/"(\/vendor\/[^"]+)"/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThanOrEqual(7)
    for (const u of urls) {
      const r = await get(handler, u)
      expect(r.status, u).toBe(200)
      expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      expect(r.headers.get('content-type')).toMatch(/text\/(javascript|css)/)
    }
  })

  it('404s anything else (traversal included), 405s other methods, HEAD has no body', async () => {
    for (const p of ['/meta.json', '/nope.js', '/../package.json', '/vendor/%2e%2e/meta.json', '/vendor', '/admin', '/api/editor-rpc']) {
      expect((await get(handler, p)).status, p).toBe(404)
    }
    expect((await get(handler, '/', { method: 'POST' })).status).toBe(405)
    const head = await get(handler, '/', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('strips basePath', async () => {
    const h = createEditorHandler({ adminOrigins: [ADMIN], basePath: '/editor/' })
    expect((await get(h, '/editor')).status).toBe(200)
    const html = await (await get(h, '/editor')).text()
    const appJs = html.match(/src="(\/app\.js[^"]*)"/)![1]
    expect((await get(h, `/editor${appJs}`)).status).toBe(200)
  })

  it('needs at least one admin origin', () => {
    expect(() => createEditorHandler({ adminOrigins: [] })).toThrow(/at least one origin/)
  })
})
