/**
 * Where theme code executes. A RenderRuntime owns compiled theme code for one artifact version
 * and hands out sessions (one fresh context per request). Everything crossing the boundary is a
 * JSON string, so a runtime can live in-process, in a worker process, or on another machine.
 */
import type { HostConfig } from '../config.ts'

export type IsolateLimits = HostConfig['isolate']

export const ENTRY_POINTS = ['__render', '__toRequest', '__fromResponse'] as const
export type Entry = (typeof ENTRY_POINTS)[number]

export type IsolateErrorKind = 'timeout' | 'memory' | 'thrown' | 'oversize' | 'invalid-output' | 'disposed'
export type CallResult<T> = { ok: true; value: T } | { ok: false; error: string; kind: IsolateErrorKind }

export interface RuntimeStats {
  isolatesCreated: number
  contextsCreated: number
  lastCompileMs: number
  /** Worker-backed runtimes only. */
  workersStarted?: number
  workersKilled?: number
}

export interface RenderSession {
  /** Calls an entry point with string args; never throws for theme-caused failures. */
  call(entry: Entry, args: string[]): Promise<CallResult<string>>
  release(): void
}

export interface RenderRuntime {
  /** A fresh, isolated execution context (one per page request / RPC). */
  session(): Promise<RenderSession>
  stats(): RuntimeStats
  dispose(): void
}

/** Creates the runtime for one artifact version. Configured via `renderer` in the host config. */
export type RendererFactory = (artifact: { id: string; bundle: string; limits: IsolateLimits }) => RenderRuntime
