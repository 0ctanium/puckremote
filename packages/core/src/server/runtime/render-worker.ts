/**
 * Worker process entry (compiled to dist/render-worker.js and launched by the worker pool).
 *
 * Runs with Node's permission model: no filesystem access beyond its own code and isolated-vm,
 * no network, no child processes, no worker threads, and an empty environment (no secrets).
 * Inside, theme code still runs in an isolated-vm Isolate (the in-process runtime), so the
 * isolate rules have a single implementation.
 *
 * Protocol (IPC, JSON): see WorkerRequest / WorkerReply in worker-pool.ts.
 */
import { IsolateRunner } from './in-process.ts'
import type { CallResult, Entry, IsolateLimits, RenderSession } from './types.ts'

type Msg =
  | { t: 'load'; id: number; version: string; bundle: string; limits: IsolateLimits }
  | { t: 'open'; id: number; version: string; sid: number }
  | { t: 'call'; id: number; sid: number; entry: Entry; args: string[] }
  | { t: 'release'; sid: number }

const log = { error: (...a: unknown[]) => console.error('[render-worker]', ...a), warn: (...a: unknown[]) => console.error('[render-worker]', ...a) }
const runtimes = new Map<string, IsolateRunner>()
const sessions = new Map<number, RenderSession>()

const send = (m: unknown) => process.send?.(m)
const disposed = (error: string): CallResult<string> => ({ ok: false, kind: 'disposed', error })

process.on('message', async (raw: unknown) => {
  const m = raw as Msg
  try {
    switch (m.t) {
      case 'load': {
        if (!runtimes.has(m.version)) runtimes.set(m.version, new IsolateRunner(m.bundle, m.limits, log))
        send({ t: 'ok', id: m.id })
        break
      }
      case 'open': {
        const rt = runtimes.get(m.version)
        if (!rt) throw new Error(`version ${m.version} not loaded`)
        sessions.set(m.sid, await rt.session())
        send({ t: 'ok', id: m.id })
        break
      }
      case 'call': {
        const s = sessions.get(m.sid)
        send({ t: 'result', id: m.id, result: s ? await s.call(m.entry, m.args) : disposed('unknown session') })
        break
      }
      case 'release': {
        sessions.get(m.sid)?.release()
        sessions.delete(m.sid)
        break
      }
    }
  } catch (e) {
    if ('id' in m) send({ t: 'error', id: m.id, error: e instanceof Error ? e.message : String(e) })
  }
})

// The host owns our lifetime: if the IPC channel closes, exit.
process.on('disconnect', () => process.exit(0))
send({ t: 'ready' })
