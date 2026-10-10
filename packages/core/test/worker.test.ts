/**
 * The worker-pool runtime: process-level sandbox, watchdog, crash recovery, recycling, and the
 * guarantee that secrets never cross into a worker.
 */
import { spawn, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareTemplate } from '../src/server/public-render.ts'
import { resolvePageData } from '../src/server/query/resolver.ts'
import { renderInIsolate } from '../src/server/render.ts'
import { bubblewrap, workerLaunchOptions, workerPoolRenderer, type WorkerPoolRuntime } from '../src/server/runtime/worker-pool.ts'
import { buildEvil, buildExample, ctx, dataDeps, env, quietLog, REPO_ROOT, SECRET_VALUE, startMockApi, testConfig, testHost, type MockApi } from './helpers.ts'

let api: MockApi
beforeAll(async () => {
  api = await startMockApi()
})
afterAll(() => api.close())

const pool = async (opts: Parameters<typeof workerPoolRenderer>[0] = {}, limits = testConfig().isolate) =>
  workerPoolRenderer({ size: 1, log: quietLog, ...opts })({ id: "test", bundle: (await buildEvil()).bundle, limits }) as WorkerPoolRuntime

describe('process sandbox (same flags as real workers)', () => {
  it('denies filesystem, network, child processes and worker threads; empty environment', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-probe-'))
    const probe = path.join(realpathSync(dir), 'probe.cjs')
    await writeFile(
      probe,
      `const out = {}
const t = (k, f) => { try { f(); out[k] = 'ALLOWED' } catch (e) { out[k] = e.code || e.message } }
t('readSecretFile', () => require('fs').readFileSync(${JSON.stringify(path.join(REPO_ROOT, 'examples', 'app', 'data', 'cms.json'))}))
t('readEtc', () => require('fs').readFileSync('/etc/hosts'))
t('write', () => require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'x.txt'))}, 'x'))
t('childProcess', () => require('child_process').execSync('true'))
t('workerThread', () => new (require('worker_threads').Worker)('1', { eval: true }))
out.env = Object.keys(process.env)
const s = require('net').connect(${new URL(api.origin).port}, '127.0.0.1')
const done = () => { process.stdout.write(JSON.stringify(out)); process.exit(0) }
s.on('error', (e) => { out.net = e.code || e.message; done() }); s.on('connect', () => { out.net = 'ALLOWED'; done() })`,
    )
    process.env.PUCK_REMOTE_TEST_HOST_SECRET = 'must-not-leak'
    const { execArgv } = workerLaunchOptions()
    const child = spawn(process.execPath, [...execArgv, `--allow-fs-read=${probe}`, probe], { env: {}, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    await new Promise((r) => child.on('exit', r))
    expect(stdout, stderr).not.toBe('')
    const out = JSON.parse(stdout)
    for (const k of ['readSecretFile', 'readEtc', 'write', 'childProcess', 'workerThread', 'net']) expect(out[k], k).toBe('ERR_ACCESS_DENIED')
    expect(out.env.filter((k: string) => !k.startsWith('__CF'))).toEqual([]) // macOS adds __CF_USER_TEXT_ENCODING
    delete process.env.PUCK_REMOTE_TEST_HOST_SECRET
  })
})

describe('resilience', () => {
  it('a stopped (hung) worker is killed by the host watchdog and replaced', async () => {
    const limits = { ...testConfig().isolate, watchdogMs: 200 }
    const rt = await pool({}, limits)
    const s = await rt.session()
    const [pid] = rt.pids()
    process.kill(pid, 'SIGSTOP')
    const t = performance.now()
    const r = await renderInIsolate(s, 'block', 'probe', {}, {}, ctx())
    expect(r).toMatchObject({ ok: false, kind: 'timeout' })
    expect(performance.now() - t).toBeLessThan(3000)
    expect(rt.stats().workersKilled).toBe(1)
    s.release()
    const s2 = await rt.session()
    expect((await renderInIsolate(s2, 'block', 'probe', {}, {}, ctx())).ok).toBe(true)
    expect(rt.pids()).not.toContain(pid)
    s2.release()
    rt.dispose()
  })

  it('a crashed worker only fails its in-flight session; the page renders on a fresh worker', async () => {
    const h = await testHost({
      theme: 'evil',
      pages: { home: { root: { props: {} }, content: [{ type: 'probe', props: { id: 'p1' } }] } },
      config: { renderer: workerPoolRenderer({ size: 1, log: quietLog }) },
    })
    expect((await prepareTemplate(h.host, 'home'))!.stats.failures).toBe(0)
    const rt = h.host.store.get().runtime as WorkerPoolRuntime
    const [pid] = rt.pids()
    process.kill(pid, 'SIGKILL')
    await vi.waitFor(() => expect(rt.pids()).not.toContain(pid))
    const page = (await prepareTemplate(h.host, 'home'))!
    expect(page.stats.failures).toBe(0)
    expect(page.rendered.p1.html).toContain('id="probe"')
    expect(rt.stats().workersStarted).toBe(2)
    await h.close()
  })

  it('workers are recycled after maxCallsPerWorker calls', async () => {
    const rt = await pool({ maxCallsPerWorker: 3 })
    const pidsSeen = new Set<number>()
    for (let i = 0; i < 4; i++) {
      const s = await rt.session()
      pidsSeen.add(rt.pids()[0])
      for (let j = 0; j < 2; j++) expect((await renderInIsolate(s, 'block', 'probe', {}, {}, ctx())).ok).toBe(true)
      s.release()
    }
    expect(pidsSeen.size).toBeGreaterThan(1)
    expect(rt.stats().workersStarted).toBeGreaterThan(1)
    rt.dispose()
  })
})

describe('secrets never reach a worker', () => {
  it('adapter requests with $secret headers: no IPC message contains the secret', async () => {
    const sent: string[] = []
    {
      const { bundle } = await buildExample()
      const tap = (_dir: string, m: unknown) => void sent.push(JSON.stringify(m))
      const runtime = workerPoolRenderer({ size: 1, log: quietLog, tap })({ id: "test", bundle, limits: testConfig().isolate })
      const h = await dataDeps({ mockOrigin: api.origin, runtime })
      const { byInstance } = await resolvePageData(
        { instances: [{ id: 'e', props: { count: 2, city: '' }, meta: h.deps.manifest.blocks['event-list'] }], env: env(), mode: 'public' },
        h.deps,
      )
      expect(byInstance.get('e')!.events).toMatchObject({ ok: true })
      expect(sent.some((m) => m.includes('__toRequest'))).toBe(true) // the adapter really ran in the worker
      expect(sent.join('\n')).not.toContain(SECRET_VALUE)
      expect(sent.some((m) => m.includes('"t":"load"'))).toBe(true) // the bundle crossed, the secret did not
      await h.close()
    }
  })
})

// Linux only (CI installs bubblewrap). Experimental OS-level layer on top of the permission model.
// Probe a real namespace: bwrap may be installed but blocked (e.g. Ubuntu's AppArmor userns policy).
const hasBwrap = spawnSync('bwrap', ['--unshare-all', '--ro-bind', '/', '/', 'true']).status === 0
describe.skipIf(!hasBwrap)('bubblewrap wrapper', () => {
  it('renders through a bwrap-wrapped worker', async () => {
    const rt = await pool({ wrap: bubblewrap() })
    const s = await rt.session()
    expect((await renderInIsolate(s, 'block', 'probe', {}, {}, ctx())).ok).toBe(true)
    s.release()
    rt.dispose()
  })
})
