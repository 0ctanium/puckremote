/**
 * Sandbox tests 1–6: what developer code can and cannot do inside the isolate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IsolateRunner } from '../src/server/runtime/in-process.ts'
import { renderInIsolate } from '../src/server/render.ts'
import { buildEvil, ctx, newRunner, testConfig } from './helpers.ts'

let runner: IsolateRunner

beforeAll(async () => {
  const { bundle } = await buildEvil()
  runner = newRunner(bundle)
})
afterAll(() => runner.dispose())

async function render(name: string, props: Record<string, unknown> = {}) {
  const s = await runner.session()
  try {
    return await renderInIsolate(s, 'block', name, props, {}, ctx())
  } finally {
    s.release()
  }
}

const probe = async () => {
  const r = await render('probe')
  if (!r.ok) throw new Error(r.error)
  const json = r.html.match(/<pre id="probe">(.*)<\/pre>/)![1].replaceAll('&quot;', '"')
  return JSON.parse(json)
}

describe('1. no ambient capabilities', () => {
  it('fetch, process, require, process.env, timers and network APIs are unavailable', async () => {
    const p = await probe()
    expect(p).toMatchObject({
      fetch: 'undefined',
      process: 'undefined',
      require: 'undefined',
      env: 'undefined',
      setTimeout: 'undefined',
      setInterval: 'undefined',
      queueMicrotask: 'undefined',
      XMLHttpRequest: 'undefined',
      WebSocket: 'undefined',
      importScripts: 'undefined',
    })
  })
})

describe('2. infinite loops', () => {
  it('while(true) is killed by the timeout and the isolate keeps working', async () => {
    const t = performance.now()
    const r = await render('spin')
    expect(r).toMatchObject({ ok: false, kind: 'timeout' })
    expect(performance.now() - t).toBeLessThan(1000)
    expect((await render('probe')).ok).toBe(true)
  })
})

describe('3. async code cannot hang the host', () => {
  it('an await loop is drained inside the call and killed by the same timeout', async () => {
    const r = await render('promise-loop')
    // Microtasks run at the end of the synchronous call (V8 checkpoint), so the loop
    // runs under the call's timeout rather than after it returns.
    expect(r).toMatchObject({ ok: false, kind: 'timeout' })
    expect((await render('probe')).ok).toBe(true)
  })

  it('setTimeout loops are impossible: there are no timers', async () => {
    const r = await render('timer-loop')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.html).toContain('threw:TypeError')
  })
})

describe('4. memory blow-up', () => {
  it('is contained; the isolate is recreated and later renders work', async () => {
    // Generous CPU timeout so the memory limit (not the timeout) is what stops the block,
    // regardless of machine load.
    const { bundle } = await buildEvil()
    const cfg = testConfig()
    const r2 = newRunner(bundle, { ...cfg, isolate: { ...cfg.isolate, callTimeoutMs: 5000, watchdogMs: 10_000 } })
    const s = await r2.session()
    const before = r2.stats().isolatesCreated
    const r = await renderInIsolate(s, 'block', 'memory-hog', {}, {}, ctx())
    s.release()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(['memory', 'disposed']).toContain(r.kind)
    const s2 = await r2.session()
    expect((await renderInIsolate(s2, 'block', 'probe', {}, {}, ctx())).ok).toBe(true)
    s2.release()
    expect(r2.stats().isolatesCreated).toBeGreaterThan(before)
    r2.dispose()
  })
})

describe('5. global mutation does not leak across requests', () => {
  it('Object.prototype / globals / JSON changes are gone in the next request context', async () => {
    const s = await runner.session()
    try {
      expect((await renderInIsolate(s, 'block', 'polluter', {}, {}, ctx())).ok).toBe(true)
      // Same request (shared context): documented POC limitation — the pollution is visible.
      const same = await renderInIsolate(s, 'block', 'probe', {}, {}, ctx())
      expect(same.ok && same.html).toContain('&quot;polluted&quot;:&quot;yes&quot;')
    } finally {
      s.release()
    }
    const p = await probe()
    expect(p.polluted).toBeNull()
    expect(p.leakedGlobal).toBeNull()
  })
})

describe('6. output limits', () => {
  it('oversized HTML is rejected', async () => {
    const r = await render('huge-output', { size: 2_000_000 })
    expect(r).toMatchObject({ ok: false, kind: 'oversize' })
  })
  it('oversized input is rejected before entering the isolate', async () => {
    const r = await render('probe', { blob: 'z'.repeat(1200 * 1024) })
    expect(r).toMatchObject({ ok: false, kind: 'oversize' })
  })
  it('a thrown error is reported, not propagated', async () => {
    const r = await render('thrower')
    expect(r).toMatchObject({ ok: false, kind: 'thrown' })
    if (!r.ok) expect(r.error).toContain('boom')
  })
})
