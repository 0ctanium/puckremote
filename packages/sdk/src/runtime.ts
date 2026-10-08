/**
 * Runs INSIDE the isolate (bundled into bundle.js). Exposes the only three entry points
 * the host calls. All inputs and outputs are JSON strings.
 */
import { createElement, Fragment } from 'react'
import { renderToString } from 'react-dom/server.browser'
import { EFFECT_LIMITS } from './constants.ts'
import { renderState } from './state.ts'
import type {
  AdapterDefinition,
  BlockDefinition,
  CtxInput,
  Effect,
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
    renderState.nonce = ctxInput.nonce
    try {
      const Block = () => def.render(props, data, ctx)
      const html = renderToString(createElement(Fragment, null, createElement(Block)))
      const out: RenderOutput = { html, effects }
      return JSON.stringify(out)
    } finally {
      renderState.nonce = null
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
