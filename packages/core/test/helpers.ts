import { build } from '@puck-remote/cli'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { devAllowAll, resolveConfig, type HostConfig } from '../src/server/config.ts'
import { IsolateRunner } from '../src/server/isolate-runner.ts'
import type { CtxInput } from '../src/server/render.ts'

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
export const FIXTURES = path.join(import.meta.dirname, 'fixtures')

const cache = new Map<string, Promise<{ outDir: string; bundle: string; manifest: any }>>()

/** Build a developer repo with the real CLI into a temp dir (cached per test process). */
export function buildTheme(dir: string) {
  if (!cache.has(dir)) {
    cache.set(
      dir,
      (async () => {
        const outDir = path.join(os.tmpdir(), `puck-remote-test-${path.basename(dir)}-${process.pid}`)
        const { manifest } = await build({ cwd: dir, outDir, quiet: true })
        return { outDir, manifest, bundle: await readFile(path.join(outDir, 'bundle.js'), 'utf8') }
      })(),
    )
  }
  return cache.get(dir)!
}

export const buildEvil = () => buildTheme(path.join(FIXTURES, 'evil'))
export const buildExample = () => buildTheme(path.join(REPO_ROOT, 'examples', 'theme'))

export function testConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const base = resolveConfig({
    artifacts: fsArtifactStore({ dir: path.join(REPO_ROOT, 'artifacts') }),
    source: mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') }),
    pages: fsPageStore({ dir: path.join(REPO_ROOT, 'data', 'pages') }),
    site: { name: 'POC Site', locale: 'en' },
    auth: devAllowAll(),
  })
  return { ...base, isolate: { ...base.isolate, callTimeoutMs: 150, watchdogMs: 1500 }, ...overrides }
}

export const quietLog = { error() {}, warn() {}, info() {} }

export function newRunner(bundle: string, cfg = testConfig()) {
  return new IsolateRunner(bundle, cfg.isolate, quietLog)
}

export function ctx(overrides: Partial<CtxInput> = {}): CtxInput {
  return {
    isEditing: false,
    locale: 'en',
    nonce: 'n0nce0000000000000000000000000000',
    page: { slug: 'home' },
    site: { name: 'Test' },
    assetBase: '/theme/v1/assets/',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Data-layer harness
// ---------------------------------------------------------------------------
import { startMockApi } from 'mock-api'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { memoryCache } from '../src/server/query/cache.ts'
import { HttpSource, type Resolver } from '../src/server/query/http-source.ts'
import { mockCms } from '@puck-remote/source-mock'
import { fsPageStore } from '@puck-remote/pages-fs'
import { HostSource } from '../src/server/query/host-source.ts'
import type { RenderSession } from '../src/server/isolate-runner.ts'

export type MockApi = Awaited<ReturnType<typeof startMockApi>>
export { startMockApi }

export const SECRET_VALUE = 'dev-events-key-7f3a9c'
export const OTHER_SECRET = 'other-secret-value-55aa'

export function dataConfig(mockOrigin: string, overrides: Partial<HostConfig> = {}): HostConfig {
  const base = testConfig()
  return {
    ...base,
    http: {
      ...base.http,
      allowedOrigins: [mockOrigin, 'https://api.example.test', 'https://evil.test', 'https://10.0.0.1', 'https://[::1]', 'https://169.254.169.254'],
      insecureDevOrigins: [mockOrigin],
      cacheTtlMs: 30_000,
    },
    secrets: {
      EVENTS_API_KEY: { value: SECRET_VALUE, origins: [mockOrigin] },
      OTHER_KEY: { value: OTHER_SECRET, origins: ['https://api.example.test'] },
    },
    ...overrides,
  }
}

export interface Recorder {
  isolateInputs: string[]
  logs: string[]
  log: Pick<Console, 'info' | 'warn' | 'error'>
}

export function recorder(): Recorder {
  const r: Recorder = { isolateInputs: [], logs: [], log: undefined as any }
  const push = (...a: unknown[]) => r.logs.push(a.map(String).join(' '))
  r.log = { info: push, warn: push, error: push }
  return r
}

/** Wraps session.call so tests can see every string that crosses into the isolate. */
export function recordingSession(s: RenderSession, rec: Recorder): RenderSession {
  const call = s.call.bind(s)
  s.call = (entry, args) => {
    rec.isolateInputs.push(entry, ...args)
    return call(entry, args)
  }
  return s
}

export async function dataDeps(opts: { mockOrigin: string; config?: HostConfig; resolver?: Resolver; rec?: Recorder }) {
  const { manifest, bundle } = await buildExample()
  const m = structuredClone(manifest)
  m.adapters.events.origin = opts.mockOrigin // test seam: mock API runs on a random port
  const config = opts.config ?? dataConfig(opts.mockOrigin)
  const rec = opts.rec ?? recorder()
  const runner = newRunner(bundle, config)
  let session: Promise<RenderSession> | null = null
  const http = new HttpSource({ config: config.http, secrets: config.secrets, resolver: opts.resolver })
  // A fresh source per harness so content edits in one test don't leak into another.
  const cms = mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') })
  const cache = memoryCache()
  cms.subscribe((tags) => void cache.invalidateTags(tags))
  const deps = {
    manifest: m,
    config,
    source: new HostSource(cms),
    http,
    cache,
    session: () => (session ??= runner.session().then((s) => recordingSession(s, rec))),
    log: rec.log,
    site: config.site,
  }
  return {
    deps,
    cms,
    rec,
    runner,
    async close() {
      if (session) (await session).release()
      runner.dispose()
      await http.close()
    },
  }
}

export const env = (query: Record<string, string> = {}) => ({
  page: { slug: 'home', locale: 'en' },
  site: { name: 'Test', locale: 'en' },
  query,
})

// ---------------------------------------------------------------------------
// Full-host harness (artifacts + pages in a temp dir)
// ---------------------------------------------------------------------------
import { publish } from '@puck-remote/cli'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createHost } from '../src/server/host.ts'

export async function testHost(opts: { theme: 'example' | 'evil'; pages: Record<string, unknown>; mockOrigin?: string; config?: Partial<HostConfig> }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-host-'))
  const artifactsDir = path.join(dir, 'artifacts')
  const pagesDir = path.join(dir, 'pages')
  await mkdir(pagesDir, { recursive: true })
  for (const [slug, data] of Object.entries(opts.pages)) await writeFile(path.join(pagesDir, `${slug}.json`), JSON.stringify(data))
  const built = opts.theme === 'evil' ? await buildEvil() : await buildExample()
  const artifacts = fsArtifactStore({ dir: artifactsDir })
  await publish({ distDir: built.outDir, artifacts, quiet: true })
  const mock = opts.mockOrigin ?? 'http://localhost:4010'
  const base = dataConfig(mock)
  const config: HostConfig = {
    ...base,
    artifacts,
    source: mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') }),
    pages: fsPageStore({ dir: pagesDir }),
    ...opts.config,
  }
  const host = createHost(config)
  ;(host.store as any).opts.disposeGraceMs = 0
  ;(host.store as any).log = quietLog
  const r = await host.store.reload()
  if (!r.ok) throw new Error(r.error)
  if (opts.mockOrigin) host.store.get().manifest.adapters.events && (host.store.get().manifest.adapters.events.origin = opts.mockOrigin)
  return { host, dir, artifactsDir, pagesDir, close: async () => { host.store.close(); await host.http.close() } }
}
