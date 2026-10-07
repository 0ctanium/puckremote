/**
 * The ONLY place developer code is executed on the host: inside an isolated-vm Isolate.
 *
 * Lifecycle: one Isolate per artifact, bundle compiled once; a fresh Context per request
 * (RenderSession). Data crosses the boundary only as JSON strings. No host References,
 * callbacks, timers, fetch, process or require are exposed.
 *
 * Calls use async `apply` (the isolate runs on its own thread) so a host-side wall-clock
 * watchdog can dispose the isolate even if V8's own `timeout` fails to fire. The code
 * inside the isolate is still fully synchronous: there are no awaits and no timers.
 */
import ivm from 'isolated-vm'
import type { HostConfig } from './config.ts'

export type IsolateLimits = HostConfig['isolate']

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: string; kind: IsolateErrorKind }
export type IsolateErrorKind = 'timeout' | 'memory' | 'thrown' | 'oversize' | 'invalid-output' | 'disposed'

export interface RunnerStats {
  isolatesCreated: number
  contextsCreated: number
  lastCompileMs: number
}

const ENTRY_POINTS = ['__render', '__toRequest', '__fromResponse'] as const
type EntryPoint = (typeof ENTRY_POINTS)[number]

function classify(e: unknown, isolate: ivm.Isolate | null): { kind: IsolateErrorKind; error: string } {
  const msg = e instanceof Error ? e.message : String(e)
  if (/timed out/i.test(msg)) return { kind: 'timeout', error: 'render timed out' }
  if (/memory limit/i.test(msg) || isolate?.isDisposed) return { kind: /memory/i.test(msg) ? 'memory' : 'disposed', error: msg }
  return { kind: 'thrown', error: msg.slice(0, 500) }
}

export class IsolateRunner {
  private isolate: ivm.Isolate | null = null
  private script: ivm.Script | null = null
  private disposed = false
  readonly stats: RunnerStats = { isolatesCreated: 0, contextsCreated: 0, lastCompileMs: 0 }

  constructor(
    private readonly bundle: string,
    readonly limits: IsolateLimits,
    private readonly log: Pick<Console, 'error' | 'warn'> = console,
  ) {
    this.ensure()
  }

  private ensure(): { isolate: ivm.Isolate; script: ivm.Script } {
    if (this.disposed) throw new Error('runner disposed')
    if (!this.isolate || this.isolate.isDisposed || !this.script) {
      const t = performance.now()
      this.isolate = new ivm.Isolate({ memoryLimit: this.limits.memoryLimitMb })
      this.script = this.isolate.compileScriptSync(this.bundle, { filename: 'bundle.js' })
      this.stats.lastCompileMs = performance.now() - t
      this.stats.isolatesCreated++
    }
    return { isolate: this.isolate, script: this.script }
  }

  /** Called by the watchdog or on fatal errors. The next session lazily recreates the isolate. */
  kill(reason: string, quiet = false): void {
    if (this.isolate && !this.isolate.isDisposed) {
      if (!quiet) this.log.error(`[isolate] disposing isolate: ${reason}`)
      try {
        this.isolate.dispose()
      } catch {}
    }
    this.script = null
  }

  async session(): Promise<RenderSession> {
    const { isolate, script } = this.ensure()
    const context = await isolate.createContext()
    this.stats.contextsCreated++
    try {
      await script.run(context, { timeout: this.limits.callTimeoutMs * 5 })
      const refs = {} as Record<EntryPoint, ivm.Reference<(...args: string[]) => string>>
      for (const name of ENTRY_POINTS) {
        const ref = await context.global.get(name, { reference: true })
        refs[name] = ref as ivm.Reference<(...args: string[]) => string>
      }
      return new RenderSession(this, isolate, context, refs)
    } catch (e) {
      context.release()
      const { error } = classify(e, isolate)
      if (isolate.isDisposed) this.script = null
      throw new Error(`failed to initialise bundle in context: ${error}`)
    }
  }

  get isolateHeapBytes(): number | null {
    try {
      return this.isolate && !this.isolate.isDisposed ? this.isolate.getHeapStatisticsSync().used_heap_size : null
    } catch {
      return null
    }
  }

  dispose(): void {
    this.disposed = true
    this.kill('runner disposed', true)
    this.isolate = null
  }
}

export class RenderSession {
  private released = false

  constructor(
    private readonly runner: IsolateRunner,
    private readonly isolate: ivm.Isolate,
    private readonly context: ivm.Context,
    private readonly refs: Record<EntryPoint, ivm.Reference<(...args: string[]) => string>>,
  ) {}

  /** Calls an entry point with string args, returning the raw string result (size-checked). */
  async call(entry: EntryPoint, args: string[]): Promise<CallResult<string>> {
    const { limits } = this.runner
    if (this.released) return { ok: false, kind: 'disposed', error: 'session released' }
    if (this.isolate.isDisposed) return { ok: false, kind: 'disposed', error: 'isolate disposed' }
    const inBytes = args.reduce((n, a) => n + Buffer.byteLength(a), 0)
    if (inBytes > limits.maxInputBytes) return { ok: false, kind: 'oversize', error: `input too large (${inBytes} bytes)` }

    let watchdog: NodeJS.Timeout | undefined
    const overrun = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        this.runner.kill(`wall-clock watchdog fired after ${limits.watchdogMs}ms in ${entry}`)
        reject(new Error('render timed out (watchdog)'))
      }, limits.watchdogMs)
    })
    try {
      const out = await Promise.race([
        this.refs[entry].apply(undefined, args, { timeout: limits.callTimeoutMs, arguments: { copy: true }, result: { copy: true } }),
        overrun,
      ])
      if (typeof out !== 'string') return { ok: false, kind: 'invalid-output', error: `${entry} returned ${typeof out}` }
      if (Buffer.byteLength(out) > limits.maxOutputBytes) return { ok: false, kind: 'oversize', error: `output too large (${out.length} chars)` }
      return { ok: true, value: out }
    } catch (e) {
      const c = classify(e, this.isolate)
      // A memory blow-up disposes the isolate; make sure the runner recreates it next time.
      if (c.kind === 'memory' || c.kind === 'disposed' || this.isolate.isDisposed) this.runner.kill(`${entry}: ${c.error}`)
      return { ok: false, ...c }
    } finally {
      clearTimeout(watchdog)
    }
  }

  release(): void {
    if (this.released) return
    this.released = true
    try {
      for (const r of Object.values(this.refs)) r.release()
      this.context.release()
    } catch {}
  }
}
