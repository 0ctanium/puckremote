/**
 * Rough cost measurements for the README: in-process isolates vs the sandboxed worker pool.
 * Requires a published artifact and the mock API (pnpm --filter mock-api start).
 * Run: pnpm --filter @puck-remote/core bench
 */
import path from 'node:path'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { mockCms } from '@puck-remote/source-mock'
import { resolveConfig } from '../src/server/config.ts'
import { createHost } from '../src/server/host.ts'
import { preparePage } from '../src/server/public-render.ts'
import { renderInIsolate } from '../src/server/render.ts'
import { inProcessRenderer } from '../src/server/runtime/in-process.ts'
import type { RendererFactory } from '../src/server/runtime/types.ts'
import { workerPoolRenderer } from '../src/server/runtime/worker-pool.ts'

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]
const p95 = (xs: number[]) => sorted(xs)[Math.floor(xs.length * 0.95)]
const ms = (n: number) => `${n.toFixed(2)} ms`
const quiet = { error() {}, warn() {}, info() {} }
console.info = () => {}

// The example app's data (examples/app/data).
const root = path.resolve(import.meta.dirname, '../../../examples/app/data')
const MOCK = 'http://localhost:4010'

async function measure(name: string, renderer: RendererFactory) {
  const host = createHost(
    resolveConfig({
      artifacts: fsArtifactStore({ dir: path.join(root, 'artifacts') }),
      renderer,
      source: mockCms({ dataFile: path.join(root, 'cms.json') }),
      http: { allowedOrigins: [MOCK], insecureDevOrigins: [MOCK] },
      secrets: { EVENTS_API_KEY: { value: 'dev-events-key-7f3a9c', origins: [MOCK] } },
    }),
  )
  ;(host.store as unknown as { log: unknown }).log = quiet
  const r = await host.store.reload()
  if (!r.ok) throw new Error(r.error)
  const { runtime, manifest, id } = host.store.get()

  let t = performance.now()
  const first = await runtime.session()
  const coldSession = performance.now() - t
  first.release()

  const sessions: number[] = []
  for (let i = 0; i < 50; i++) {
    t = performance.now()
    const s = await runtime.session()
    sessions.push(performance.now() - t)
    s.release()
  }

  const ctx = { isEditing: false, locale: 'en', nonce: 'x'.repeat(32), page: { slug: 'home' }, site: { name: 'Bench' }, assetBase: '/cdn/assets/', assetVersions: {} }
  const data = { posts: { ok: true, data: { docs: Array.from({ length: 12 }, (_, i) => ({ title: `Post ${i}`, slug: `p${i}` })), totalDocs: 12, limit: 12 } }, events: { ok: true, data: [] }, results: { ok: true, data: { docs: [] } }, site: { ok: true, data: { tagline: 't', footer: 'f' } } }
  const renders: number[] = []
  const s = await runtime.session()
  for (let i = 0; i < 100; i++) {
    for (const [block, meta] of Object.entries(manifest.blocks)) {
      t = performance.now()
      await renderInIsolate(s, 'block', block, { ...meta.defaultProps, id: 'b' }, data, ctx)
      renders.push(performance.now() - t)
    }
  }
  s.release()

  const pages: number[] = []
  let blocks = 0
  for (let i = 0; i < 30; i++) {
    t = performance.now()
    const p = await preparePage(host, 'home', {})
    pages.push(performance.now() - t)
    blocks = p!.stats.blocks
  }

  console.log(
    `| ${name} | ${ms(coldSession)} | ${ms(median(sessions))} | ${ms(median(renders))} / ${ms(p95(renders))} | ${ms(median(pages))} (${blocks} blocks) |`,
  )
  host.store.close()
  await host.http.close()
}

console.log('| runtime | first session (cold) | session (warm, median) | block render median / p95 | preparePage home, warm data |')
console.log('|---|---|---|---|---|')
await measure('in-process', inProcessRenderer({ log: quiet }))
await measure('worker pool', workerPoolRenderer({ log: quiet }))
