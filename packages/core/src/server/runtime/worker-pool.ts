/**
 * Worker-pool runtime (default): theme code runs in isolated-vm inside separate Node processes
 * that are started with the permission model and an empty environment.
 *
 * What this layer adds over the in-process runtime:
 *  - secrets, files, network and child processes are unreachable from the renderer process;
 *  - a crash, OOM or hang only kills a worker (respawned), never the host;
 *  - the host-side watchdog can SIGKILL a stuck worker even if the isolate's timeout fails.
 * What it does NOT add: protection against a native-code V8 escape (isolated-vm is an addon, and
 * Node's permission model does not constrain native code). Use the `wrap` option with an OS
 * sandbox (see bubblewrap()) or a remote renderer for that.
 */
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallResult, Entry, IsolateLimits, RenderRuntime, RenderSession, RendererFactory, RuntimeStats } from './types.ts'

export interface WorkerPoolOptions {
  /** Max concurrent workers. Default min(4, CPUs). */
  size?: number
  /** Replace a worker after this many calls (bounds leaks / heap growth). Default 5000. */
  maxCallsPerWorker?: number
  /** Node heap cap for each worker process, in MB. Default 256. */
  maxOldSpaceMb?: number
  /**
   * Wrap the worker launch in an OS sandbox, e.g. bubblewrap(). Receives the node command line
   * and returns the command to run instead.
   */
  wrap?: (command: string, args: string[]) => { command: string; args: string[] }
  log?: Pick<Console, 'error' | 'warn' | 'info'>
  /** Diagnostics: observe every IPC message to/from workers (tracing, tests). Must not throw. */
  tap?: (direction: 'send' | 'receive', message: unknown) => void
}

export interface WorkerLaunch {
  workerPath: string
  execArgv: string[]
  env: Record<string, string>
}

const here = fileURLToPath(import.meta.url)

/** dist/render-worker.js, both from compiled code (sibling chunk) and from sources (tests). */
function workerPath(): string {
  const p = here.endsWith('.ts') ? path.resolve(path.dirname(here), '../../../dist/render-worker.js') : path.join(path.dirname(here), 'render-worker.js')
  if (!existsSync(p)) throw new Error(`puck-remote: render worker not found at ${p} (build @puck-remote/core first)`)
  return p
}

/**
 * Directories the worker may read: its own code, and exactly what module resolution touches to
 * load isolated-vm (each node_modules dir on the lookup path up to the one containing it, plus
 * real paths behind pnpm-style symlinks). Nothing else.
 */
function readAllowlist(worker: string): string[] {
  const dirs = new Set<string>([path.dirname(worker)])
  const resolveFrom = (from: string, name: string): string => {
    const req = createRequire(from)
    for (const dir of req.resolve.paths(name) ?? []) {
      dirs.add(dir)
      if (existsSync(path.join(dir, name))) break
    }
    const pkg = path.dirname(req.resolve(`${name}/package.json`))
    dirs.add(pkg)
    dirs.add(path.dirname(pkg))
    return pkg
  }
  const ivm = resolveFrom(worker, 'isolated-vm')
  const ngb = resolveFrom(path.join(ivm, 'package.json'), 'node-gyp-build')
  dirs.add(realpathSync(ivm))
  dirs.add(realpathSync(ngb))
  // The permission model checks real paths: include both spellings (symlinked installs, /var → /private/var…).
  const all = new Set<string>()
  for (const d of dirs) {
    if (!existsSync(d)) continue
    all.add(d)
    all.add(realpathSync(d))
  }
  return [...all]
}

let launchCache: WorkerLaunch | null = null

/** How workers are started (exported for the permission test). */
export function workerLaunchOptions(opts: Pick<WorkerPoolOptions, 'maxOldSpaceMb'> = {}): WorkerLaunch {
  if (!launchCache) {
    const worker = workerPath()
    launchCache = {
      workerPath: worker,
      execArgv: [
        '--no-node-snapshot',
        '--permission',
        // isolated-vm is a native addon. Node warns this weakens the permission model: native code
        // is not checked. The flags still block every JavaScript-level API below.
        '--allow-addons',
        ...readAllowlist(worker).map((d) => `--allow-fs-read=${d}`),
        '--disable-warning=SecurityWarning',
      ],
      env: {},
    }
  }
  return { ...launchCache, execArgv: [...launchCache.execArgv, `--max-old-space-size=${opts.maxOldSpaceMb ?? 256}`] }
}

/**
 * Experimental OS sandbox for Linux: run each worker in a bubblewrap namespace with no network,
 * a read-only root and a private /tmp. Requires `bwrap` on the PATH.
 */
export function bubblewrap(extraArgs: string[] = []): NonNullable<WorkerPoolOptions['wrap']> {
  return (command, args) => ({
    command: 'bwrap',
    args: ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--dev', '/dev', '--proc', '/proc', ...extraArgs, command, ...args],
  })
}

// ---------------------------------------------------------------------------

type Reply = { t: 'ready' } | { t: 'ok'; id: number } | { t: 'error'; id: number; error: string } | { t: 'result'; id: number; result: CallResult<string> }

class Worker {
  readonly child: ChildProcess
  readonly ready: Promise<void>
  alive = true
  openSessions = 0
  calls = 0
  private nextId = 1
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
  private loaded = new Set<string>()

  private readonly tap: WorkerPoolOptions['tap']

  constructor(launch: WorkerLaunch, opts: WorkerPoolOptions, onExit: (w: Worker) => void) {
    const log = opts.log ?? console
    this.tap = opts.tap
    if (opts.wrap) {
      const { command, args } = opts.wrap(process.execPath, [...launch.execArgv, launch.workerPath])
      this.child = spawn(command, args, { env: launch.env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    } else {
      this.child = fork(launch.workerPath, [], { execArgv: launch.execArgv, env: launch.env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    }
    const forward = (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) if (line.trim()) log.error(`[render-worker ${this.child.pid}] ${line}`)
    }
    this.child.stdout?.on('data', forward)
    this.child.stderr?.on('data', forward)
    this.ready = new Promise((resolve, reject) => {
      const onMsg = (m: Reply) => {
        if (m.t === 'ready') {
          this.child.off('message', onMsg)
          resolve()
        }
      }
      this.child.on('message', onMsg)
      this.child.once('exit', (code) => reject(new Error(`render worker exited during startup (code ${code})`)))
    })
    this.ready.catch(() => {})
    this.child.on('message', (m: Reply) => {
      this.tap?.('receive', m)
      if (m.t === 'ready') return
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      p.resolve(m)
    })
    this.child.once('exit', () => {
      this.alive = false
      for (const p of this.pending.values()) p.reject(new Error('render worker exited'))
      this.pending.clear()
      onExit(this)
    })
  }

  request(msg: Record<string, unknown>): Promise<Reply> {
    if (!this.alive) return Promise.reject(new Error('render worker is not running'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.tap?.('send', { ...msg, id })
      this.child.send({ ...msg, id }, (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  async load(version: string, bundle: string, limits: IsolateLimits) {
    if (this.loaded.has(version)) return
    const r = await this.request({ t: 'load', version, bundle, limits })
    if (r.t === 'error') throw new Error(r.error)
    this.loaded.add(version)
  }

  post(msg: Record<string, unknown>) {
    if (!this.alive) return
    this.tap?.('send', msg)
    this.child.send(msg, () => {})
  }

  kill(signal: NodeJS.Signals = 'SIGKILL') {
    if (this.alive) this.child.kill(signal)
  }
}

class WorkerSession implements RenderSession {
  private released = false
  constructor(
    private readonly pool: WorkerPoolRuntime,
    private readonly worker: Worker,
    private readonly sid: number,
  ) {}

  async call(entry: Entry, args: string[]): Promise<CallResult<string>> {
    if (this.released) return { ok: false, kind: 'disposed', error: 'session released' }
    if (!this.worker.alive) return { ok: false, kind: 'disposed', error: 'render worker exited' }
    const { limits } = this.pool
    const inBytes = args.reduce((n, a) => n + Buffer.byteLength(a), 0)
    if (inBytes > limits.maxInputBytes) return { ok: false, kind: 'oversize', error: `input too large (${inBytes} bytes)` }
    this.worker.calls++
    // Host-side watchdog, beyond the isolate's own timeout and the in-worker watchdog: if the
    // worker doesn't answer, it is killed (and replaced on the next session).
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<CallResult<string>>((resolve) => {
      timer = setTimeout(() => {
        this.pool.log.error(`[puck-remote] render worker ${this.worker.child.pid} unresponsive in ${entry}; killing it`)
        this.pool.killWorker(this.worker)
        resolve({ ok: false, kind: 'timeout', error: 'render timed out (worker killed)' })
      }, limits.watchdogMs * 2 + 500)
    })
    try {
      return await Promise.race([
        this.worker.request({ t: 'call', sid: this.sid, entry, args }).then((r): CallResult<string> =>
          r.t === 'result' ? r.result : { ok: false, kind: 'disposed', error: r.t === 'error' ? r.error : 'unexpected reply' },
        ),
        deadline,
      ])
    } catch (e) {
      return { ok: false, kind: 'disposed', error: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.pool.releaseSession(this.worker, this.sid)
  }
}

class WorkerPoolRuntime implements RenderRuntime {
  private workers: Worker[] = []
  private nextSid = 1
  private disposed = false
  private counters = { workersStarted: 0, workersKilled: 0, contextsCreated: 0 }
  readonly log: Pick<Console, 'error' | 'warn' | 'info'>

  constructor(
    private readonly version: string,
    private readonly bundle: string,
    readonly limits: IsolateLimits,
    private readonly opts: WorkerPoolOptions,
  ) {
    this.log = opts.log ?? console
  }

  private get size() {
    return Math.max(1, this.opts.size ?? Math.min(4, os.availableParallelism?.() ?? os.cpus().length))
  }

  private spawnWorker(): Worker {
    const w = new Worker(workerLaunchOptions(this.opts), this.opts, (dead) => {
      this.workers = this.workers.filter((x) => x !== dead)
    })
    this.counters.workersStarted++
    this.workers.push(w)
    return w
  }

  /** Least-busy live worker that hasn't hit its recycle threshold; spawn while under `size`. */
  private pick(): Worker {
    const max = this.opts.maxCallsPerWorker ?? 5000
    for (const w of this.workers) {
      // Retire workers past their call budget once idle.
      if (w.alive && w.calls >= max && w.openSessions === 0) this.retire(w)
    }
    const usable = this.workers.filter((w) => w.alive && w.calls < max)
    const idle = usable.find((w) => w.openSessions === 0)
    if (idle) return idle
    if (this.workers.length < this.size) return this.spawnWorker()
    if (usable.length) return usable.reduce((a, b) => (b.openSessions < a.openSessions ? b : a))
    return this.spawnWorker()
  }

  private retire(w: Worker) {
    w.alive = false
    w.child.disconnect()
    this.workers = this.workers.filter((x) => x !== w)
  }

  killWorker(w: Worker) {
    this.counters.workersKilled++
    w.kill('SIGKILL')
  }

  async session(): Promise<RenderSession> {
    if (this.disposed) throw new Error('runtime disposed')
    // Retry once on a fresh worker if the chosen one died during startup/open.
    for (let attempt = 0; ; attempt++) {
      const w = this.pick()
      try {
        await w.ready
        await w.load(this.version, this.bundle, this.limits)
        const sid = this.nextSid++
        const r = await w.request({ t: 'open', version: this.version, sid })
        if (r.t === 'error') throw new Error(r.error)
        w.openSessions++
        this.counters.contextsCreated++
        return new WorkerSession(this, w, sid)
      } catch (e) {
        if (attempt >= 1 || w.alive) throw new Error(`failed to open render session: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  releaseSession(w: Worker, sid: number) {
    w.openSessions = Math.max(0, w.openSessions - 1)
    w.post({ t: 'release', sid })
  }

  stats(): RuntimeStats {
    return { isolatesCreated: this.counters.workersStarted, lastCompileMs: 0, ...this.counters }
  }

  /** Live worker PIDs (diagnostics, tests). */
  pids(): number[] {
    return this.workers.filter((w) => w.alive).map((w) => w.child.pid!)
  }

  dispose(): void {
    this.disposed = true
    for (const w of this.workers) w.kill('SIGKILL')
    this.workers = []
  }
}

/** Run theme code in sandboxed worker processes (default). */
export function workerPoolRenderer(opts: WorkerPoolOptions = {}): RendererFactory {
  return ({ id, bundle, limits }) => new WorkerPoolRuntime(id, bundle, limits, opts)
}

export type { WorkerPoolRuntime }
