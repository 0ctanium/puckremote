/**
 * Runs INSIDE the isolate (bundled into bundle.js). Exposes the only three entry points
 * the host calls. All inputs and outputs are JSON strings.
 */
import { createElement, Fragment, type ComponentType, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server.browser'
import { EFFECT_LIMITS, HYDRATE_MODES, ISLAND_LIMITS } from './constants.ts'
import { renderState } from './state.ts'
import type {
  AdapterDefinition,
  BlockDefinition,
  CtxInput,
  Effect,
  HydrateMode,
  IslandRecord,
  RenderCtx,
  RenderOutput,
  RootDefinition,
  ScriptOptions,
} from './types.ts'

export interface Registry {
  blocks: Record<string, BlockDefinition<any, any>>
  root: RootDefinition<any, any> | null
  adapters: Record<string, AdapterDefinition>
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new TypeError(`${what} must be a string`)
  if (v.length > EFFECT_LIMITS.maxStringLength) throw new RangeError(`${what} too long`)
  return v
}

function makeCtx(input: CtxInput, effects: Effect[]): RenderCtx {
  const push = (e: Effect) => {
    if (effects.length >= EFFECT_LIMITS.maxEffects) throw new RangeError('too many head/asset effects')
    effects.push(e)
  }
  return {
    isEditing: input.isEditing,
    locale: input.locale,
    nonce: input.nonce,
    page: { slug: input.page.slug },
    site: { name: input.site.name },
    assetUrl(path) {
      const clean = str(path, 'asset path').replace(/^\/+/, '')
      if (clean.split('/').some((seg) => seg === '..' || seg === '.') || /[\\?#]|:\/\//.test(clean)) {
        throw new Error(`invalid asset path: ${path}`)
      }
      return input.assetBase + clean
    },
    assets: {
      script(url: string, opts: ScriptOptions = {}) {
        push({ kind: 'script', url: str(url, 'script url'), opts: { defer: !!opts.defer, async: !!opts.async, module: !!opts.module } })
      },
      style(url: string) {
        push({ kind: 'style', url: str(url, 'style url') })
      },
    },
    head: {
      title(t: string) {
        push({ kind: 'title', value: str(t, 'title') })
      },
      meta(name: string, content: string) {
        push({ kind: 'meta', name: str(name, 'meta name'), content: str(content, 'meta content') })
      },
    },
  }
}

/** JSON-only island props; anything a JSON round-trip would change or drop is refused. */
function islandProps(id: string, props: Record<string, unknown>): { props: Record<string, unknown>; hydrate: HydrateMode } {
  const { hydrate = HYDRATE_MODES[0], ...rest } = props
  if (!(HYDRATE_MODES as readonly unknown[]).includes(hydrate)) throw new Error(`island ${id}: hydrate must be one of ${HYDRATE_MODES.join(', ')}`)
  if ('children' in rest) throw new Error(`island ${id}: children cannot be passed to an island`)
  const json = JSON.stringify(rest)
  if (json.length > ISLAND_LIMITS.maxPropsBytes) throw new RangeError(`island ${id}: props exceed ${ISLAND_LIMITS.maxPropsBytes} bytes`)
  if (!sameJson(rest, JSON.parse(json))) throw new TypeError(`island ${id}: props must be JSON (no functions, elements, dates, undefined or class instances)`)
  return { props: rest, hydrate: hydrate as HydrateMode }
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return typeof a !== 'number' || Number.isFinite(a)
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const proto = Object.getPrototypeOf(a)
  if (!Array.isArray(a) && proto !== Object.prototype && proto !== null) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => sameJson((a as any)[k], (b as any)[k]))
}

export function install(registry: Registry): void {
  const g = globalThis as any

  g.__render = (kind: 'block' | 'root', name: string, propsJson: string, dataJson: string, ctxJson: string): string => {
    const def = kind === 'root' ? registry.root : Object.hasOwn(registry.blocks, name) ? registry.blocks[name] : undefined
    if (!def) throw new Error(`unknown ${kind}: ${name}`)
    const props = { ...(def.defaultProps ?? {}), ...JSON.parse(propsJson) }
    const data = JSON.parse(dataJson)
    const ctxInput = JSON.parse(ctxJson) as CtxInput
    const effects: Effect[] = []
    const ctx = makeCtx(ctxInput, effects)
    // Islands render a marker during the block render, then their own HTML afterwards (React's
    // renderToString is not reentrant). Islands nested in an island render as plain components.
    const pending: { record: Omit<IslandRecord, 'html'>; component: ComponentType<any> }[] = []
    const marker = (id: string, component: ComponentType<any>, raw: Record<string, unknown>): ReactElement => {
      const { props, hydrate } = islandProps(id, raw)
      const key = `i${pending.length}`
      pending.push({ record: { key, id, props, hydrate }, component })
      return createElement('div', { 'data-puck-island': key, 'data-nonce': ctxInput.nonce })
    }
    renderState.nonce = ctxInput.nonce
    renderState.island = marker
    try {
      const Block = () => def.render(props, data, ctx)
      const html = renderToString(createElement(Fragment, null, createElement(Block)))
      renderState.island = null
      const islands: IslandRecord[] = pending.map(({ record, component }) => ({
        ...record,
        html: renderToString(createElement(component, record.props)),
      }))
      const out: RenderOutput = { html, effects, islands }
      return JSON.stringify(out)
    } finally {
      renderState.nonce = null
      renderState.island = null
    }
  }

  const adapter = (name: string): AdapterDefinition => {
    if (!Object.hasOwn(registry.adapters, name)) throw new Error(`unknown adapter: ${name}`)
    return registry.adapters[name]
  }

  g.__toRequest = (name: string, queryJson: string): string =>
    JSON.stringify(adapter(name).toRequest(JSON.parse(queryJson)))

  g.__fromResponse = (name: string, responseJson: string, queryJson: string): string => {
    const out = adapter(name).fromResponse(JSON.parse(responseJson), JSON.parse(queryJson))
    const s = JSON.stringify(out)
    if (s === undefined) throw new Error('fromResponse must return JSON-serializable data')
    return s
  }
}
