/**
 * createPuckRemote().loadTemplate: the app names the template; unknown templates and host
 * (admin) origins answer 404; params reach the core.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let host = 'www.example.com'
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host }) }))

const prepareTemplate = vi.fn()
// createCore memoizes per config id on globalThis: a stub core stands in for the real one.
;(globalThis as Record<symbol, unknown>)[Symbol.for('remote.core:load-template-test')] = {
  config: { origins: { host: ['http://admin.example.com'], editor: 'http://editor.example.net' } },
  prepareTemplate,
}
const { createPuckRemote } = await import('../src/index.ts')
const remote = createPuckRemote({ id: 'load-template-test' } as never)

const isNotFound = (e: unknown) => String((e as { digest?: string })?.digest ?? '').includes('404')

beforeEach(() => {
  host = 'www.example.com'
  prepareTemplate.mockReset()
})

describe('loadTemplate', () => {
  it('renders the named template with its params and search params', async () => {
    prepareTemplate.mockResolvedValue({ template: 'product' })
    await remote.loadTemplate('product', { params: { handle: 'red' }, searchParams: Promise.resolve({ q: ['a', 'b'] }) })
    expect(prepareTemplate).toHaveBeenCalledWith('product', { params: { handle: 'red' }, query: { q: 'a' }, locale: undefined })
  })

  it('calls notFound() for an unknown template', async () => {
    prepareTemplate.mockResolvedValue(null)
    const e = await remote.loadTemplate('nope').catch((x) => x)
    expect(isNotFound(e)).toBe(true)
  })

  it('calls notFound() on a host (admin) origin', async () => {
    host = 'admin.example.com'
    const e = await remote.loadTemplate('home').catch((x) => x)
    expect(isNotFound(e)).toBe(true)
    expect(prepareTemplate).not.toHaveBeenCalled()
  })
})
