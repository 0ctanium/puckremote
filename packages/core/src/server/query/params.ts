import { createHash } from 'node:crypto'

export interface ParamEnv {
  props: Record<string, unknown>
  template: { name: string; locale: string }
  /** Params the app passed to loadTemplate. */
  params: Record<string, string>
  site: { locale: string; name: string }
  /** URL search params of the current request (public renders only). */
  query: Record<string, string>
}

export class QueryError extends Error {
  constructor(
    readonly code: string,
    message: string = code,
  ) {
    super(message)
  }
}

const isRef = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && Object.keys(v)[0].startsWith('$')

/** Replace $prop/$template/$params/$site/$query refs with concrete values. $secret refs are left for the HTTP layer. */
export function substitute(v: unknown, env: ParamEnv): unknown {
  if (Array.isArray(v)) return v.map((x) => substitute(x, env))
  if (!v || typeof v !== 'object') return v
  if (isRef(v)) {
    const [k, name] = Object.entries(v)[0]
    switch (k) {
      case '$prop': {
        const val = Object.hasOwn(env.props, name) ? env.props[name] : null
        // Props are untrusted editor input: only JSON scalars may flow into queries.
        return val === undefined || (val !== null && typeof val === 'object') ? null : val
      }
      case '$template':
        return name === 'name' ? env.template.name : name === 'locale' ? env.template.locale : null
      case '$params':
        return Object.hasOwn(env.params, name) ? env.params[name] : null
      case '$site':
        return name === 'locale' ? env.site.locale : name === 'name' ? env.site.name : null
      case '$query':
        return Object.hasOwn(env.query, name) ? String(env.query[name]).slice(0, 256) : null
      case '$secret':
        return v
      default:
        throw new QueryError('invalid-ref', `unknown ref ${k}`)
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = substitute(x, env)
  return out
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

export const hashSpec = (v: unknown) => createHash('sha256').update(stableStringify(v)).digest('hex').slice(0, 32)
