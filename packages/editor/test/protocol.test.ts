/** The postMessage protocol and both sides' checks (origin, source, version, size, rate). */
import { describe, expect, it, vi } from 'vitest'
import { initProblem } from '../src/bridge.tsx'
import { frameProblem, hostMessageHandler } from '../src/frame.tsx'
import { editorToHostSchema, hostToEditorSchema, LIMITS, measure, PROTOCOL_VERSION, rateLimiter, type EditorPayload, type HostToEditor } from '../src/protocol.ts'

const ADMIN = 'https://admin.example.com'
const EDITOR = 'https://editor.example.net'
const payload: EditorPayload = {
  artifact: 'a'.repeat(64),
  slug: 'home',
  manifest: { blocks: {}, root: null, categories: {} } as never,
  data: { root: { props: {} }, content: [] },
  bundleUrl: `${ADMIN}/theme/${'a'.repeat(64)}/bundle.browser.js`,
  assetBase: `${ADMIN}/theme/${'a'.repeat(64)}/assets/`,
  origins: { admin: [ADMIN], editor: EDITOR },
  site: { name: 'S', locale: 'en' },
}

function harness(rpc: Record<string, (p: unknown) => unknown> = {}) {
  const win = {}
  const sent: HostToEditor[] = []
  const changes: unknown[] = []
  const errors: string[] = []
  let t = 0
  const handle = hostMessageHandler({
    editorOrigin: EDITOR,
    source: () => win,
    post: (m) => sent.push(m),
    init: () => ({ payload, options: { flags: { beta: true } } }),
    rpc: () => rpc,
    onChange: (d) => changes.push(d),
    onError: (m) => errors.push(m),
    now: () => t,
  })
  const from = (data: unknown, o: { origin?: string; source?: unknown } = {}) => handle({ origin: o.origin ?? EDITOR, source: 'source' in o ? o.source : win, data })
  return { win, sent, changes, errors, from, tick: (ms: number) => (t += ms) }
}

describe('message schemas', () => {
  it('accept the six typed messages with the current version, nothing else', () => {
    expect(editorToHostSchema.safeParse({ v: 1, type: 'ready' }).success).toBe(true)
    expect(editorToHostSchema.safeParse({ v: 1, type: 'rpc', id: 1, method: 'resolveData', params: {} }).success).toBe(true)
    expect(hostToEditorSchema.safeParse({ v: 1, type: 'init', payload, options: {} }).success).toBe(true)
    expect(hostToEditorSchema.safeParse({ v: 1, type: 'rpc:result', id: 1, ok: false, error: 'x' }).success).toBe(true)
    expect(editorToHostSchema.safeParse({ v: 2, type: 'ready' }).success).toBe(false)
    expect(editorToHostSchema.safeParse({ v: 1, type: 'publish' }).success).toBe(false)
    expect(editorToHostSchema.safeParse({ v: 1, type: 'ready', extra: 1 }).success).toBe(false)
    expect(editorToHostSchema.safeParse({ v: 1, type: 'rpc', id: 1, method: 'a b', params: {} }).success).toBe(false)
    // Options are JSON only.
    expect(hostToEditorSchema.safeParse({ v: 1, type: 'init', payload, options: { flags: { x: 'no' } } }).success).toBe(false)
  })

  it('measure counts JSON bytes and Blob bytes, and rejects non-JSON values', () => {
    expect(measure({ a: 'é' })).toEqual({ jsonBytes: 10, blobBytes: 0 })
    expect(measure({ file: new Blob(['abcd']) })).toEqual({ jsonBytes: 13, blobBytes: 4 })
    expect(measure({ f: () => 1 })).toBeNull()
    expect(measure(new Map())).toBeNull()
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(measure(cyc)).toBeNull()
  })

  it('rateLimiter allows a burst, then refills over time', () => {
    let t = 0
    const allow = rateLimiter(3, () => t)
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false])
    t += 400
    expect(allow()).toBe(true)
    expect(allow()).toBe(false)
  })
})

describe('host side (<PuckEditorFrame>)', () => {
  it('refuses to load outside an admin origin or with mismatched editor origins', () => {
    const p = { editorUrl: `${EDITOR}/`, editorOrigin: EDITOR, payload }
    expect(frameProblem(p, ADMIN)).toBeNull()
    expect(frameProblem(p, 'https://www.example.com')).toMatch(/not on a configured admin origin/)
    expect(frameProblem({ ...p, editorUrl: 'https://other.example.net/' }, ADMIN)).toMatch(/not on editorOrigin/)
    expect(frameProblem({ ...p, editorUrl: 'https://other.example.net/', editorOrigin: 'https://other.example.net' }, ADMIN)).toMatch(/does not match/)
  })

  it('answers ready with init; ignores other origins and other windows', async () => {
    const h = harness()
    await h.from({ v: 1, type: 'ready' }, { origin: 'https://evil.test' })
    await h.from({ v: 1, type: 'ready' }, { source: {} })
    await h.from({ v: 1, type: 'ready' }, { source: null })
    expect(h.sent).toEqual([])
    await h.from({ v: 1, type: 'ready' })
    expect(h.sent).toEqual([{ v: PROTOCOL_VERSION, type: 'init', payload, options: { flags: { beta: true } } }])
  })

  it('validates changes and reports invalid messages', async () => {
    const h = harness()
    await h.from({ v: 1, type: 'change', data: { root: { props: {} }, content: [{ type: 'card', props: { id: 'c' } }] } })
    expect(h.changes).toHaveLength(1)
    await h.from({ v: 1, type: 'change', data: { content: 'nope' } })
    await h.from({ v: 2, type: 'ready' })
    expect(h.changes).toHaveLength(1)
    expect(h.errors).toEqual(['invalid message from the editor', 'invalid message from the editor (protocol version mismatch)'])
    await h.from({ v: 1, type: 'change', data: { root: { props: { big: 'x'.repeat(LIMITS.pageBytes) } }, content: [] } })
    expect(h.errors.at(-1)).toBe('page data too large')
  })

  it('runs allow-listed RPC handlers only, with size and rate limits', async () => {
    const resolveData = vi.fn(async (p: unknown) => ({ got: p }))
    const h = harness({ resolveData, broken: () => Promise.reject(new Error('nope')), blob: () => new Blob(['x']) })
    await h.from({ v: 1, type: 'rpc', id: 1, method: 'resolveData', params: { block: 'hero' } })
    await h.from({ v: 1, type: 'rpc', id: 2, method: 'fetch', params: { url: 'https://evil.test' } })
    await h.from({ v: 1, type: 'rpc', id: 3, method: 'toString', params: {} })
    await h.from({ v: 1, type: 'rpc', id: 4, method: 'broken', params: {} })
    await h.from({ v: 1, type: 'rpc', id: 5, method: 'blob', params: {} })
    await h.from({ v: 1, type: 'rpc', id: 6, method: 'resolveData', params: { big: 'x'.repeat(LIMITS.rpcBytes) } })
    expect(h.sent).toEqual([
      { v: 1, type: 'rpc:result', id: 1, ok: true, value: { got: { block: 'hero' } } },
      { v: 1, type: 'rpc:result', id: 2, ok: false, error: 'unknown method fetch' },
      { v: 1, type: 'rpc:result', id: 3, ok: false, error: 'unknown method toString' },
      { v: 1, type: 'rpc:result', id: 4, ok: false, error: 'nope' },
      { v: 1, type: 'rpc:result', id: 5, ok: false, error: 'result too large or not JSON' },
      { v: 1, type: 'rpc:result', id: 6, ok: false, error: 'request too large' },
    ])
    expect(resolveData).toHaveBeenCalledTimes(1)

    const r = harness({ resolveData })
    for (let i = 0; i < LIMITS.rpcPerSecond + 5; i++) await r.from({ v: 1, type: 'rpc', id: i, method: 'resolveData', params: {} })
    expect(r.sent.filter((m) => m.type === 'rpc:result' && !m.ok && m.error === 'rate limited')).toHaveLength(5)
    r.tick(1000)
    await r.from({ v: 1, type: 'rpc', id: 99, method: 'resolveData', params: {} })
    expect(r.sent.at(-1)).toMatchObject({ id: 99, ok: true })
  })

  it('uploads: File/Blob params are allowed up to the upload limit', async () => {
    const upload = vi.fn(async (p: unknown) => ({ size: ((p as { file: Blob }).file).size }))
    const h = harness({ upload })
    await h.from({ v: 1, type: 'rpc', id: 1, method: 'upload', params: { file: new Blob(['hello']) } })
    expect(h.sent.at(-1)).toEqual({ v: 1, type: 'rpc:result', id: 1, ok: true, value: { size: 5 } })
    await h.from({ v: 1, type: 'rpc', id: 2, method: 'upload', params: { file: new Blob([new Uint8Array(LIMITS.uploadBytes + 1)]) } })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(h.errors.at(-1)).toBe('message too large or not serializable')
  })
})

describe('editor side (bridge)', () => {
  it('accepts init only on the configured editor origin, from a configured admin origin, with theme URLs on an admin origin', () => {
    expect(initProblem(payload, ADMIN, EDITOR)).toBeNull()
    expect(initProblem(payload, ADMIN, 'https://elsewhere.test')).toMatch(/not on the configured editor origin/)
    expect(initProblem(payload, 'https://evil.test', EDITOR)).toMatch(/not a configured admin origin/)
    expect(initProblem({ ...payload, bundleUrl: 'https://cdn.evil.test/x.js' }, ADMIN, EDITOR)).toMatch(/not on an admin origin/)
    expect(initProblem({ ...payload, origins: { admin: [ADMIN, EDITOR], editor: EDITOR } }, ADMIN, EDITOR)).toMatch(/must not share/)
  })
})
