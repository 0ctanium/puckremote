/**
 * createPuckRemote().loadTemplate: the app names the template; unknown templates and host
 * (admin) origins answer 404; params reach the core.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let host = 'www.example.com'
let cookie: string | undefined
let reloadCookie: string | undefined
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host }),
  cookies: async () => ({
    get: (name: string) => {
      const value = name === 'puck_remote_preview' ? cookie : name === 'puck_remote_reload' ? reloadCookie : undefined
      return value === undefined ? undefined : { name, value }
    },
  }),
}))

const prepareTemplate = vi.fn()
// createCore memoizes per config id on globalThis: a stub core stands in for the real one.
;(globalThis as Record<symbol, unknown>)[Symbol.for('remote.core:load-template-test')] = {
  config: { origins: { host: ['http://admin.example.com'], editor: 'http://editor.example.net' } },
  prepareTemplate,
  previewTheme: (v: string | undefined) => (v === 'valid' ? '0123456789ab' : null),
}
const { createPuckRemote } = await import('../src/index.ts')
const remote = createPuckRemote({ id: 'load-template-test' } as never)

const isNotFound = (e: unknown) => String((e as { digest?: string })?.digest ?? '').includes('404')

beforeEach(() => {
  host = 'www.example.com'
  cookie = undefined
  reloadCookie = undefined
  prepareTemplate.mockReset()
})

describe('loadTemplate', () => {
  it('renders the named template with its params and search params', async () => {
    prepareTemplate.mockResolvedValue({ template: 'product' })
    await remote.loadTemplate('product', { params: { handle: 'red' }, searchParams: Promise.resolve({ q: ['a', 'b'] }) })
    expect(prepareTemplate).toHaveBeenCalledWith('product', { params: { handle: 'red' }, query: { q: 'a' }, locale: undefined })
  })

  it('renders the previewed theme of a valid preview cookie, and ignores an invalid one', async () => {
    prepareTemplate.mockResolvedValue({ template: 'home' })
    cookie = 'valid'
    await remote.loadTemplate('home')
    expect(prepareTemplate).toHaveBeenLastCalledWith('home', { params: {}, query: {}, locale: undefined, theme: '0123456789ab' })
    cookie = 'forged'
    await remote.loadTemplate('home', { params: { x: '1' } })
    expect(prepareTemplate).toHaveBeenLastCalledWith('home', { params: { x: '1' }, query: {}, locale: undefined })
  })

  it('passes the reload cookie only during a preview', async () => {
    prepareTemplate.mockResolvedValue({ template: 'home' })
    reloadCookie = encodeURIComponent('http://127.0.0.1:9293')
    await remote.loadTemplate('home')
    expect(prepareTemplate).toHaveBeenLastCalledWith('home', { params: {}, query: {}, locale: undefined })
    cookie = 'valid'
    await remote.loadTemplate('home', { params: { p: '1' } })
    expect(prepareTemplate).toHaveBeenLastCalledWith('home', { params: { p: '1' }, query: {}, locale: undefined, theme: '0123456789ab', reload: 'http://127.0.0.1:9293' })
  })

  it('calls notFound() for an unknown template', async () => {
    prepareTemplate.mockResolvedValue(null)
    const e = await remote.loadTemplate('nope').catch((x) => x)
    expect(isNotFound(e)).toBe(true)
  })

  it('the artifacts handler exports every method the API uses', () => {
    expect(Object.keys(remote.createArtifactsHandler({ authorize: () => true })).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST'])
  })

  it('calls notFound() on a host (admin) origin', async () => {
    host = 'admin.example.com'
    const e = await remote.loadTemplate('home').catch((x) => x)
    expect(isNotFound(e)).toBe(true)
    expect(prepareTemplate).not.toHaveBeenCalled()
  })
})
