import { build } from '@poc/cli'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultHostConfig, type HostConfig } from '../src/server/config.ts'
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
        const outDir = path.join(os.tmpdir(), `poc-test-${path.basename(dir)}-${process.pid}`)
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
  const base = defaultHostConfig()
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
    assetBase: '/theme-assets/v1/',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Data-layer harness
// ---------------------------------------------------------------------------
import { startMockApi } from 'mock-api'
import { QueryCache } from '../src/server/query/cache.ts'
import { HttpSource, type Resolver } from '../src/server/query/http-source.ts'
import { PayloadMock } from '../src/server/query/payload-mock.ts'
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
  const deps = {
    manifest: m,
    config,
    payload: new PayloadMock(config.payload, path.join(REPO_ROOT, 'data', 'payload.json')),
    http,
    cache: new QueryCache(),
    session: () => (session ??= runner.session().then((s) => recordingSession(s, rec))),
    log: rec.log,
    site: config.site,
  }
  return {
    deps,
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
