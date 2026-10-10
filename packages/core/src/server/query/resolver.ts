/**
 * Resolves every data spec on a page: substitute params → dedupe by hash → static budget →
 * run in parallel with a wall-clock deadline. Blocks receive QueryResult values only.
 */
import { z } from 'zod'
import type { HostConfig } from '../config.ts'
import type { RenderSession } from '../runtime/types.ts'
import type { Manifest, QuerySpec } from '../manifest-schema.ts'
import type { Instance } from '../page-tree.ts'
import type { HttpSource } from './http-source.ts'
import { hashSpec, QueryError, substitute, type ParamEnv } from './params.ts'
import type { Mode } from '@puck-remote/sdk/host'
import type { HostSource } from './host-source.ts'

export type QueryResult = { ok: true; data: unknown } | { ok: false; error: string }

export interface ResolveDeps {
  manifest: Manifest
  config: HostConfig
  /** The operator's data source, wrapped in host-side policy enforcement. */
  source: HostSource
  http: HttpSource
  /** Lazily provides an isolate context for adapter translators (shared with the render pass). */
  session: () => Promise<RenderSession>
  log?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface ResolveInput {
  instances: Pick<Instance, 'id' | 'props' | 'meta'>[]
  env: Omit<ParamEnv, 'props'>
  /** Set by the host only: 'draft' for editor requests, 'public' otherwise. */
  mode: Mode
}

export interface ResolveStats {
  planned: number
  unique: number
  executed: number
  budgetDropped: number
  responseBytes: number
  ms: number
}

const adapterRequestSchema = z.strictObject({
  method: z.enum(['GET', 'POST']),
  path: z.string().startsWith('/').max(2048),
  params: z.record(z.string(), z.unknown()).optional(),
  headers: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.union([z.string().max(4096), z.strictObject({ $secret: z.string() })])).optional(),
})

interface Planned {
  hash: string
  spec: QuerySpec
  consumers: { instanceId: string; key: string }[]
}

export async function resolvePageData(input: ResolveInput, deps: ResolveDeps): Promise<{ byInstance: Map<string, Record<string, QueryResult>>; stats: ResolveStats }> {
  const t0 = performance.now()
  const log = deps.log ?? console
  const { budget } = deps.config
  const byInstance = new Map<string, Record<string, QueryResult>>()
  const plan = new Map<string, Planned>()
  let planned = 0

  // 1. Plan: substitute params and dedupe, in tree order.
  for (const inst of input.instances) {
    const results: Record<string, QueryResult> = {}
    byInstance.set(inst.id, results)
    if (!inst.meta) continue
    for (const [key, spec] of Object.entries(inst.meta.data)) {
      planned++
      const concrete = substitute(spec, { ...input.env, props: inst.props }) as QuerySpec
      const hash = hashSpec({ mode: concrete.source === 'host' ? input.mode : 'any', concrete })
      const p = plan.get(hash) ?? { hash, spec: concrete, consumers: [] }
      p.consumers.push({ instanceId: inst.id, key })
      plan.set(hash, p)
    }
  }

  // 2. Static budget, before anything runs: queries beyond the cap (in tree order) degrade.
  const ordered = [...plan.values()]
  const runnable = ordered.slice(0, budget.maxQueries)
  const dropped = ordered.slice(budget.maxQueries)
  if (dropped.length) log.warn(`[query] budget: ${ordered.length} unique queries > max ${budget.maxQueries}; ${dropped.length} degraded`)

  // 3. Execute in parallel under a page-level deadline.
  const deadline = AbortSignal.timeout(budget.maxWallMs)
  // One shared deadline promise; the no-op catch keeps it from surfacing as an unhandled rejection.
  const overDeadline = new Promise<never>((_, reject) => {
    deadline.addEventListener('abort', () => reject(new QueryError('budget', 'page wall-time budget exceeded')), { once: true })
  })
  overDeadline.catch(() => {})
  let executed = 0
  const outcomes = new Map<string, { result: QueryResult; bytes: number }>()
  await Promise.all(
    runnable.map(async (p) => {
      try {
        executed++
        const data = await Promise.race([execute(p.spec, input.mode, input.env.template.locale, deps, deadline), overDeadline])
        const bytes = Buffer.byteLength(JSON.stringify(data) ?? '')
        outcomes.set(p.hash, { result: { ok: true, data }, bytes })
      } catch (e) {
        const code = e instanceof QueryError ? e.code : 'unavailable'
        log.warn(`[query] ${p.spec.source} query failed (${code}): ${e instanceof Error ? e.message : e}`)
        outcomes.set(p.hash, { result: { ok: false, error: code }, bytes: 0 })
      }
    }),
  )

  // 4. Response-size budget, applied deterministically in tree order.
  let responseBytes = 0
  let budgetDropped = dropped.length
  for (const p of runnable) {
    const o = outcomes.get(p.hash)!
    responseBytes += o.bytes
    if (o.result.ok && responseBytes > budget.maxResponseBytes) {
      o.result = { ok: false, error: 'budget' }
      budgetDropped++
    }
  }
  if (responseBytes > budget.maxResponseBytes) log.warn(`[query] budget: ${responseBytes} response bytes > max ${budget.maxResponseBytes}`)
  for (const p of dropped) outcomes.set(p.hash, { result: { ok: false, error: 'budget' }, bytes: 0 })

  for (const p of ordered) {
    for (const c of p.consumers) byInstance.get(c.instanceId)![c.key] = outcomes.get(p.hash)!.result
  }
  return {
    byInstance,
    stats: { planned, unique: ordered.length, executed, budgetDropped, responseBytes, ms: performance.now() - t0 },
  }
}

async function execute(spec: QuerySpec, mode: Mode, locale: string, deps: ResolveDeps, signal: AbortSignal): Promise<unknown> {
  switch (spec.source) {
    case 'host': {
      const ctx = { mode, locale, signal }
      if (spec.op === 'find') return deps.source.find(spec.collection, spec.args as Record<string, unknown>, ctx)
      if (spec.op === 'findByID') return deps.source.findByID(spec.collection, spec.id, spec.args as Record<string, unknown>, ctx)
      return deps.source.global(spec.slug, ctx)
    }
    case 'http': {
      const res = await deps.http.fetchJson(
        { origin: spec.origin, path: spec.path, method: spec.method, params: spec.params as Record<string, unknown>, headers: spec.headers },
        signal,
      )
      return res.json
    }
    case 'adapter': {
      const adapter = Object.hasOwn(deps.manifest.adapters, spec.adapter) ? deps.manifest.adapters[spec.adapter] : null
      if (!adapter) throw new QueryError('unknown-adapter')
      const session = await deps.session()
      const queryJson = JSON.stringify({ op: spec.op, params: spec.params })
      const reqOut = await session.call('__toRequest', [spec.adapter, queryJson])
      if (!reqOut.ok) throw new QueryError('adapter', `toRequest failed: ${reqOut.error}`)
      const parsed = adapterRequestSchema.safeParse(JSON.parse(reqOut.value))
      if (!parsed.success) throw new QueryError('adapter', `toRequest returned an invalid request: ${parsed.error.issues[0]?.message}`)
      const req = parsed.data
      const res = await deps.http.fetchJson(
        { origin: adapter.origin, path: req.path, method: req.method, params: req.params ?? {}, headers: req.headers ?? {} },
        signal,
      )
      const out = await session.call('__fromResponse', [spec.adapter, JSON.stringify(res.json), queryJson])
      if (!out.ok) throw new QueryError('adapter', `fromResponse failed: ${out.error}`)
      return JSON.parse(out.value)
    }
  }
}
