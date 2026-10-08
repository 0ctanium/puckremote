/**
 * Build-time validation of developer definitions. Runs on the developer's machine against the
 * imported modules, and turns them into plain JSON for the manifest. The host re-validates
 * the result with its own zod schema; this is about failing early with good messages.
 */
import {
  FIELD_TYPES,
  FORBIDDEN_DEFINITION_KEYS,
  PAGE_REF_KEYS,
  SITE_REF_KEYS,
  WHERE_OPERATORS,
} from '@puck-remote/sdk/constants'

export class BuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuildError'
  }
}

const fail = (path: string, msg: string): never => {
  throw new BuildError(`${path}: ${msg}`)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Deep-copies `v` as JSON, failing on anything that would not survive JSON round-tripping. */
export function toJson(v: unknown, path: string): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : fail(path, `non-finite number ${v}`)
  if (typeof v === 'function') return fail(path, 'function values are not allowed here (only `render` may be a function)')
  if (v === undefined) return fail(path, 'undefined is not serializable; omit the key instead')
  if (typeof v !== 'object') return fail(path, `${typeof v} is not serializable`)
  if (Array.isArray(v)) return v.map((x, i) => toJson(x, `${path}[${i}]`))
  if (!isPlainObject(v)) return fail(path, `non-plain object (${Object.getPrototypeOf(v)?.constructor?.name ?? 'unknown'}) is not serializable`)
  if (Object.getOwnPropertySymbols(v).length) fail(path, 'symbol keys are not serializable')
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    out[k] = toJson(x, `${path}.${k}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const COMMON_FIELD_KEYS = ['type', 'label', 'visibleIf']
const FIELD_KEYS: Record<string, string[]> = {
  text: ['placeholder'],
  textarea: ['placeholder'],
  number: ['min', 'max', 'step'],
  select: ['options'],
  radio: ['options'],
  array: ['arrayFields', 'itemSummary', 'defaultItemProps', 'min', 'max'],
  object: ['objectFields'],
  slot: ['allow', 'disallow'],
  'host:color': [],
  'host:media': [],
  'host:link': [],
}

function validateVisibleIf(v: unknown, path: string, siblings: string[]): void {
  if (!isPlainObject(v)) fail(path, 'visibleIf must be an object like { field, eq | in | not } or { and | or: [...] }')
  const o = v as Record<string, unknown>
  if ('and' in o || 'or' in o) {
    const key = 'and' in o ? 'and' : 'or'
    if (Object.keys(o).length !== 1 || !Array.isArray(o[key])) fail(path, `{ ${key}: [...] } must have exactly one key holding an array`)
    ;(o[key] as unknown[]).forEach((c, i) => validateVisibleIf(c, `${path}.${key}[${i}]`, siblings))
    return
  }
  const keys = Object.keys(o).sort()
  const op = keys.find((k) => k !== 'field')
  if (keys.length !== 2 || !('field' in o) || !op || !['eq', 'in', 'not'].includes(op)) {
    fail(path, 'visibleIf condition must be { field, eq } | { field, in } | { field, not } (no expression strings)')
  }
  if (typeof o.field !== 'string' || !siblings.includes(o.field)) fail(path, `visibleIf.field must name a sibling field (got ${JSON.stringify(o.field)})`)
  if (op === 'in' && !Array.isArray(o.in)) fail(path, 'visibleIf.in must be an array')
}

export function validateFields(fields: unknown, path: string, allowSlots: boolean): Record<string, unknown> {
  if (!isPlainObject(fields)) fail(path, 'fields must be a plain object')
  const names = Object.keys(fields as object)
  for (const [name, f] of Object.entries(fields as Record<string, unknown>)) {
    const fp = `${path}.${name}`
    if (name.startsWith('__')) fail(fp, 'field names starting with "__" are reserved by the host')
    if (!isPlainObject(f)) fail(fp, 'field must be a plain object')
    const field = f as Record<string, unknown>
    const type = field.type
    if (type === 'custom' || type === 'external') {
      fail(fp, `field type "${type}" is not supported; use a host-owned type (host:color, host:media, host:link) instead`)
    }
    if (typeof type !== 'string' || !(FIELD_TYPES as readonly string[]).includes(type)) {
      fail(fp, `unsupported field type ${JSON.stringify(type)}; allowed: ${FIELD_TYPES.join(', ')}`)
    }
    for (const [k, v] of Object.entries(field)) {
      if (typeof v === 'function') fail(`${fp}.${k}`, 'function-valued field options are not allowed')
      if (!COMMON_FIELD_KEYS.includes(k) && !FIELD_KEYS[type as string].includes(k)) {
        fail(`${fp}.${k}`, `unknown option for a "${type}" field`)
      }
    }
    if (field.visibleIf !== undefined) validateVisibleIf(field.visibleIf, `${fp}.visibleIf`, names)
    if (type === 'select' || type === 'radio') {
      if (!Array.isArray(field.options) || field.options.length === 0) fail(`${fp}.options`, 'options must be a non-empty array')
      ;(field.options as unknown[]).forEach((o, i) => {
        if (!isPlainObject(o) || typeof o.label !== 'string' || !['string', 'number', 'boolean'].includes(typeof o.value)) {
          fail(`${fp}.options[${i}]`, 'each option must be { label: string, value: string | number | boolean }')
        }
      })
    }
    if (type === 'array') {
      validateFields(field.arrayFields, `${fp}.arrayFields`, false)
      if (field.itemSummary !== undefined && (typeof field.itemSummary !== 'string' || !(field.itemSummary in (field.arrayFields as object)))) {
        fail(`${fp}.itemSummary`, 'itemSummary must name one of the arrayFields (a string, not a function)')
      }
    }
    if (type === 'object') validateFields(field.objectFields, `${fp}.objectFields`, false)
    if (type === 'slot' && !allowSlots) fail(fp, 'slot fields are only supported at the top level of a block')
  }
  return toJson(fields, path) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Query specs
// ---------------------------------------------------------------------------

export interface QueryAnalysis {
  propRefs: string[]
  usesRequestParams: boolean
}

const REF_KEYS = ['$prop', '$page', '$site', '$query', '$secret']

function walkRefs(v: unknown, path: string, a: QueryAnalysis, allowSecret: boolean): void {
  if (Array.isArray(v)) return v.forEach((x, i) => walkRefs(x, `${path}[${i}]`, a, allowSecret))
  if (!isPlainObject(v)) return
  const refKey = Object.keys(v).find((k) => k.startsWith('$'))
  if (refKey) {
    if (!REF_KEYS.includes(refKey) || Object.keys(v).length !== 1) fail(path, `invalid param reference ${JSON.stringify(v)}`)
    const val = (v as Record<string, unknown>)[refKey]
    if (typeof val !== 'string' || !val) fail(path, `${refKey} must be a non-empty string`)
    if (refKey === '$prop') a.propRefs.push(val as string)
    if (refKey === '$query') a.usesRequestParams = true
    if (refKey === '$page' && !(PAGE_REF_KEYS as readonly string[]).includes(val as string)) fail(path, `$page supports ${PAGE_REF_KEYS.join(', ')}`)
    if (refKey === '$site' && !(SITE_REF_KEYS as readonly string[]).includes(val as string)) fail(path, `$site supports ${SITE_REF_KEYS.join(', ')}`)
    if (refKey === '$secret' && !allowSecret) fail(path, '$secret is only allowed in http()/adapter request headers')
    return
  }
  for (const [k, x] of Object.entries(v)) walkRefs(x, `${path}.${k}`, a, allowSecret)
}

function validateWhere(w: unknown, path: string): void {
  if (!isPlainObject(w)) fail(path, 'where must be an object')
  for (const [k, v] of Object.entries(w as object)) {
    if (k === 'and' || k === 'or') {
      if (!Array.isArray(v)) fail(`${path}.${k}`, 'must be an array')
      ;(v as unknown[]).forEach((c, i) => validateWhere(c, `${path}.${k}[${i}]`))
      continue
    }
    if (!isPlainObject(v)) fail(`${path}.${k}`, 'condition must be an object like { equals: value }')
    const ops = Object.keys(v as object)
    if (ops.length !== 1 || !(WHERE_OPERATORS as readonly string[]).includes(ops[0])) {
      fail(`${path}.${k}`, `unsupported operator ${JSON.stringify(ops)}; allowed: ${WHERE_OPERATORS.join(', ')}, and, or`)
    }
  }
}

export function validateQuery(spec: unknown, path: string, adapters: Set<string>): { spec: Record<string, unknown>; analysis: QueryAnalysis } {
  const json = toJson(spec, path) as Record<string, unknown>
  if (!isPlainObject(json)) fail(path, 'query must be built with find/findByID/global/query/http')
  const a: QueryAnalysis = { propRefs: [], usesRequestParams: false }
  switch (json.source) {
    case 'host': {
      if (json.op === 'find') {
        const args = (json.args ?? {}) as Record<string, unknown>
        if (args.where !== undefined) validateWhere(args.where, `${path}.where`)
      } else if (json.op !== 'findByID' && json.op !== 'global') fail(path, `unknown host data source op ${json.op}`)
      walkRefs(json, path, a, false)
      break
    }
    case 'adapter':
      if (typeof json.adapter !== 'string' || !adapters.has(json.adapter)) fail(path, `unknown adapter ${JSON.stringify(json.adapter)}`)
      walkRefs(json, path, a, false)
      break
    case 'http': {
      let u: URL
      try {
        u = new URL(String(json.origin))
      } catch {
        return fail(`${path}.origin`, 'must be an absolute origin like https://api.example.com')
      }
      if (u.origin !== json.origin) fail(`${path}.origin`, `must be a bare origin (got ${json.origin}, expected ${u.origin})`)
      if (typeof json.path !== 'string' || !json.path.startsWith('/')) fail(`${path}.path`, 'must start with /')
      walkRefs({ ...json, headers: undefined }, path, a, false)
      walkRefs(json.headers, `${path}.headers`, a, true)
      break
    }
    default:
      fail(path, 'query must be built with find/findByID/global/query/http')
  }
  a.propRefs = [...new Set(a.propRefs)].sort()
  return { spec: json, analysis: a }
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export interface BlockMeta {
  label: string
  category?: string
  fields: Record<string, unknown>
  defaultProps: Record<string, unknown>
  data: Record<string, unknown>
  propRefs: Record<string, string[]>
  usesRequestParams: boolean
  slots: string[]
  version: number
}

export function validateDefinition(def: unknown, kind: 'block' | 'root', name: string, adapters: Set<string>): BlockMeta {
  const path = kind === 'root' ? 'root.tsx' : `blocks/${name}`
  if (!isPlainObject(def)) fail(path, `default export must be ${kind === 'root' ? 'defineRoot' : 'defineBlock'}({...})`)
  const d = def as Record<string, unknown>
  for (const k of FORBIDDEN_DEFINITION_KEYS) {
    if (k in d) fail(`${path}.${k}`, `"${k}" is not supported${k === 'resolveFields' ? '; use declarative visibleIf on fields' : k === 'resolveData' ? '; declare queries in `data`' : ''}`)
  }
  const allowed = kind === 'root' ? ['fields', 'defaultProps', 'data', 'render', 'version', 'migrations'] : ['label', 'category', 'fields', 'defaultProps', 'data', 'render', 'version', 'migrations']
  for (const k of Object.keys(d)) if (!allowed.includes(k)) fail(`${path}.${k}`, 'unknown key')
  if (typeof d.render !== 'function') fail(`${path}.render`, 'render must be a function')
  if (d.label !== undefined && typeof d.label !== 'string') fail(`${path}.label`, 'must be a string')
  if (d.category !== undefined && typeof d.category !== 'string') fail(`${path}.category`, 'must be a string')
  const version = (d.version ?? 1) as number
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) fail(`${path}.version`, 'must be an integer >= 1')
  if (d.migrations !== undefined && !isPlainObject(d.migrations)) fail(`${path}.migrations`, 'must be an object of functions keyed by version')
  const migrations = (d.migrations ?? {}) as Record<string, unknown>
  for (let v = 2; v <= version; v++) {
    if (typeof migrations[v] !== 'function') fail(`${path}.migrations.${v}`, `missing migration from version ${v - 1} to ${v}`)
  }
  for (const k of Object.keys(migrations)) {
    const v = Number(k)
    if (!Number.isInteger(v) || v < 2 || v > version) fail(`${path}.migrations.${k}`, `unexpected key: migrations go from 2 to version (${version})`)
  }

  const fields = validateFields(d.fields ?? {}, `${path}.fields`, true)
  if (kind === 'root' && 'children' in fields) fail(`${path}.fields.children`, '"children" is reserved for the page body')
  const defaultProps = toJson(d.defaultProps ?? {}, `${path}.defaultProps`) as Record<string, unknown>
  if (!isPlainObject(d.data ?? {})) fail(`${path}.data`, 'data must be an object of query specs')
  const data: Record<string, unknown> = {}
  const propRefs: Record<string, string[]> = {}
  let usesRequestParams = false
  for (const [key, spec] of Object.entries((d.data ?? {}) as Record<string, unknown>)) {
    const r = validateQuery(spec, `${path}.data.${key}`, adapters)
    for (const p of r.analysis.propRefs) if (!(p in fields)) fail(`${path}.data.${key}`, `$prop "${p}" is not a field of this block`)
    data[key] = r.spec
    propRefs[key] = r.analysis.propRefs
    usesRequestParams ||= r.analysis.usesRequestParams
  }
  const slots = Object.entries(fields)
    .filter(([, f]) => (f as { type: string }).type === 'slot')
    .map(([n]) => n)
  return {
    label: (d.label as string | undefined) ?? name,
    ...(d.category ? { category: d.category as string } : {}),
    fields,
    defaultProps,
    data,
    propRefs,
    usesRequestParams,
    slots,
    version,
  }
}

export function validateAdapter(def: unknown, file: string): { name: string; origin: string } {
  const path = `adapters/${file}`
  if (!isPlainObject(def)) fail(path, 'default export must be defineAdapter({...})')
  const d = def as Record<string, unknown>
  for (const k of Object.keys(d)) if (!['name', 'origin', 'toRequest', 'fromResponse'].includes(k)) fail(`${path}.${k}`, 'unknown key')
  if (typeof d.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(d.name)) fail(`${path}.name`, 'must be a lowercase identifier')
  if (typeof d.toRequest !== 'function' || typeof d.fromResponse !== 'function') fail(path, 'toRequest and fromResponse must be functions')
  let u: URL
  try {
    u = new URL(String(d.origin))
  } catch {
    return fail(`${path}.origin`, 'must be an absolute origin')
  }
  if (u.origin !== d.origin) fail(`${path}.origin`, `must be a bare origin (expected ${u.origin})`)
  return { name: d.name as string, origin: d.origin as string }
}
