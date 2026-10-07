/**
 * Rough cost measurements for the README. Requires a published artifact and the mock API
 * (pnpm --filter mock-api start). Run: pnpm --filter host bench
 */
import path from 'node:path'
import { fsPageStore } from '@poc/pages-fs'
import { mockCms } from '@poc/source-mock'
import { resolveConfig } from '../src/server/config.ts'
import { createHost } from '../src/server/host.ts'
import { IsolateRunner } from '../src/server/isolate-runner.ts'
import { preparePage } from '../src/server/public-render.ts'
import { renderInIsolate } from '../src/server/render.ts'

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const fmt = (n: number) => `${n.toFixed(2)} ms`

const root = path.resolve(import.meta.dirname, '../../..')
const MOCK = 'http://localhost:4010'
const host = createHost(
  resolveConfig({
    artifactsDir: path.join(root, 'artifacts'),
    source: mockCms({ dataFile: path.join(root, 'data', 'cms.json') }),
    pages: fsPageStore({ dir: path.join(root, 'data', 'pages') }),
    http: { allowedOrigins: [MOCK], insecureDevOrigins: [MOCK] },
    secrets: { EVENTS_API_KEY: { value: 'dev-events-key-7f3a9c', origins: [MOCK] } },
  }),
)
console.log = ((orig) => (...a: unknown[]) => (String(a[0]).startsWith('[') ? undefined : orig(...a)))(console.log)
console.info = () => {}
const r = await host.store.reload()
if (!r.ok) throw new Error(r.error)
const { bundle, manifest, version } = host.store.get()

const compile: number[] = []
for (let i = 0; i < 10; i++) {
  const t = performance.now()
  new IsolateRunner(bundle, host.config.isolate).dispose()
  compile.push(performance.now() - t)
}

const runner = new IsolateRunner(bundle, host.config.isolate)
const ctxMs: number[] = []
for (let i = 0; i < 50; i++) {
  const t = performance.now()
  const s = await runner.session()
  ctxMs.push(performance.now() - t)
  s.release()
}

const perBlock: Record<string, number[]> = {}
const s = await runner.session()
const ctx = { isEditing: false, locale: 'en', nonce: 'x'.repeat(32), page: { slug: 'home' }, site: { name: 'Bench' }, assetBase: `/theme/v${version}/assets/` }
const data = { posts: { ok: true, data: { docs: Array.from({ length: 12 }, (_, i) => ({ title: `Post ${i}`, slug: `p${i}` })), totalDocs: 12, limit: 12 } }, events: { ok: true, data: [] }, results: { ok: true, data: { docs: [] } }, site: { ok: true, data: { tagline: 't', footer: 'f' } } }
for (let i = 0; i < 200; i++) {
  for (const [name, meta] of Object.entries(manifest.blocks)) {
    const t = performance.now()
    await renderInIsolate(s, 'block', name, { ...meta.defaultProps, id: 'b' }, data, ctx)
    ;(perBlock[name] ??= []).push(performance.now() - t)
  }
}
s.release()

const page: number[] = []
const stats: any[] = []
for (let i = 0; i < 30; i++) {
  const t = performance.now()
  const p = await preparePage(host, 'home', {})
  page.push(performance.now() - t)
  stats.push(p!.stats)
}

console.log(`bundle.js: ${(bundle.length / 1024).toFixed(0)} KB, blocks: ${Object.keys(manifest.blocks).length}`)
console.log(`isolate create + compileScript (cold, median of 10): ${fmt(median(compile))}`)
console.log(`fresh context + run bundle (per request, median of 50): ${fmt(median(ctxMs))}`)
for (const [n, xs] of Object.entries(perBlock)) console.log(`render ${n.padEnd(16)} median ${fmt(median(xs))}  p95 ${fmt([...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)])}`)
console.log(`preparePage('home') warm (data cached), median of 30: ${fmt(median(page))}; blocks=${stats.at(-1).blocks}; context=${fmt(median(stats.map((x) => x.contextMs)))}, render=${fmt(median(stats.map((x) => x.renderMs)))}, data=${fmt(median(stats.map((x) => x.data.ms)))}`)
console.log(`first preparePage (cold data): data=${fmt(stats[0].data.ms)} unique queries=${stats[0].data.unique} executed=${stats[0].data.executed}`)
runner.dispose()
host.store.close()
await host.http.close()
