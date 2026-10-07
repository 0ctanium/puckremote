/**
 * The host's own definition of what a valid artifact manifest is. The CLI's output is never
 * trusted: everything is re-validated here, including closed field types, the visibleIf
 * grammar and the query spec language.
 */
import { z } from 'zod'

const ident = z.string().regex(/^[a-z][a-z0-9-]*$/)
const fieldName = z.string().min(1).max(64).regex(/^(?!__)[A-Za-z_$][\w$-]*$/)
const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()])

export type VisibleIf =
  | { field: string; eq: z.infer<typeof primitive> }
  | { field: string; in: z.infer<typeof primitive>[] }
  | { field: string; not: z.infer<typeof primitive> }
  | { and: VisibleIf[] }
  | { or: VisibleIf[] }

export const visibleIfSchema: z.ZodType<VisibleIf> = z.lazy(() =>
  z.union([
    z.strictObject({ field: z.string(), eq: primitive }),
    z.strictObject({ field: z.string(), in: z.array(primitive) }),
    z.strictObject({ field: z.string(), not: primitive }),
    z.strictObject({ and: z.array(visibleIfSchema) }),
    z.strictObject({ or: z.array(visibleIfSchema) }),
  ]),
)

const base = { label: z.string().max(200).optional(), visibleIf: visibleIfSchema.optional() }
const option = z.strictObject({ label: z.string().max(200), value: z.union([z.string(), z.number(), z.boolean()]) })

export type FieldSpec =
  | { type: 'text' | 'textarea'; label?: string; visibleIf?: VisibleIf; placeholder?: string }
  | { type: 'number'; label?: string; visibleIf?: VisibleIf; min?: number; max?: number; step?: number }
  | { type: 'select' | 'radio'; label?: string; visibleIf?: VisibleIf; options: { label: string; value: string | number | boolean }[] }
  | {
      type: 'array'
      label?: string
      visibleIf?: VisibleIf
      arrayFields: Record<string, FieldSpec>
      itemSummary?: string
      defaultItemProps?: Record<string, unknown>
      min?: number
      max?: number
    }
  | { type: 'object'; label?: string; visibleIf?: VisibleIf; objectFields: Record<string, FieldSpec> }
  | { type: 'slot'; label?: string; visibleIf?: VisibleIf; allow?: string[]; disallow?: string[] }
  | { type: 'host:color' | 'host:media' | 'host:link'; label?: string; visibleIf?: VisibleIf }

export const fieldSchema: z.ZodType<FieldSpec> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.enum(['text', 'textarea']), ...base, placeholder: z.string().max(200).optional() }),
    z.strictObject({ type: z.literal('number'), ...base, min: z.number().optional(), max: z.number().optional(), step: z.number().optional() }),
    z.strictObject({ type: z.enum(['select', 'radio']), ...base, options: z.array(option).min(1).max(200) }),
    z.strictObject({
      type: z.literal('array'),
      ...base,
      arrayFields: fieldsSchema,
      itemSummary: z.string().optional(),
      defaultItemProps: z.record(z.string(), z.unknown()).optional(),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().positive().optional(),
    }),
    z.strictObject({ type: z.literal('object'), ...base, objectFields: fieldsSchema }),
    z.strictObject({ type: z.literal('slot'), ...base, allow: z.array(z.string()).optional(), disallow: z.array(z.string()).optional() }),
    z.strictObject({ type: z.enum(['host:color', 'host:media', 'host:link']), ...base }),
  ]),
)

export const fieldsSchema: z.ZodType<Record<string, FieldSpec>> = z.lazy(() => z.record(fieldName, fieldSchema))

// ---------------------------------------------------------------------------
// Query specs
// ---------------------------------------------------------------------------

export const paramRefSchema = z.union([
  z.strictObject({ $prop: z.string().min(1) }),
  z.strictObject({ $page: z.enum(['slug', 'locale']) }),
  z.strictObject({ $site: z.enum(['locale', 'name']) }),
  z.strictObject({ $query: z.string().min(1).max(64) }),
])
export type ParamRef = z.infer<typeof paramRefSchema>
export const secretRefSchema = z.strictObject({ $secret: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })

const param = z.union([primitive, paramRefSchema])
export type ParamValue = z.infer<typeof param> | ParamValue[] | { [k: string]: ParamValue }
const paramValue: z.ZodType<ParamValue> = z.lazy(() =>
  z.union([param, z.array(paramValue), z.record(z.string().regex(/^[^$]/), paramValue)]),
)

export type WhereClause = { and: WhereClause[] } | { or: WhereClause[] } | Record<string, WhereCondition>
export type WhereCondition =
  | { equals: z.infer<typeof param> }
  | { in: z.infer<typeof param>[] | ParamRef }
  | { contains: z.infer<typeof param> }
  | { gt: z.infer<typeof param> }
  | { lt: z.infer<typeof param> }

const whereCondition = z.union([
  z.strictObject({ equals: param }),
  z.strictObject({ in: z.union([z.array(param), paramRefSchema]) }),
  z.strictObject({ contains: param }),
  z.strictObject({ gt: param }),
  z.strictObject({ lt: param }),
])
export const whereSchema: z.ZodType<WhereClause> = z.lazy(() =>
  z.union([
    z.strictObject({ and: z.array(whereSchema) }),
    z.strictObject({ or: z.array(whereSchema) }),
    z.record(z.string().regex(/^[A-Za-z_][\w.]*$/).refine((k) => k !== 'and' && k !== 'or'), whereCondition),
  ]),
)

const origin = z.string().refine((s) => {
  try {
    return new URL(s).origin === s
  } catch {
    return false
  }
}, 'must be a bare origin')

export const querySpecSchema = z.discriminatedUnion('source', [
  z.discriminatedUnion('op', [
    z.strictObject({
      source: z.literal('host'),
      op: z.literal('find'),
      collection: z.string(),
      args: z.strictObject({
        where: whereSchema.optional(),
        limit: z.union([z.number().int(), paramRefSchema]).optional(),
        sort: z.string().regex(/^-?[A-Za-z_][\w.]*$/).optional(),
        select: z.array(z.string()).optional(),
        depth: z.number().int().optional(),
        page: z.union([z.number().int(), paramRefSchema]).optional(),
      }),
    }),
    z.strictObject({
      source: z.literal('host'),
      op: z.literal('findByID'),
      collection: z.string(),
      id: z.union([z.string(), paramRefSchema]),
      args: z.strictObject({ select: z.array(z.string()).optional(), depth: z.number().int().optional() }),
    }),
    z.strictObject({ source: z.literal('host'), op: z.literal('global'), slug: z.string() }),
  ]),
  z.strictObject({ source: z.literal('adapter'), adapter: ident, op: z.string().max(64), params: z.record(z.string(), paramValue) }),
  z.strictObject({
    source: z.literal('http'),
    origin,
    path: z.string().startsWith('/').max(2048),
    method: z.enum(['GET', 'POST']),
    params: z.record(z.string(), paramValue),
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.union([z.string().max(4096), secretRefSchema])),
  }),
])
export type QuerySpec = z.infer<typeof querySpecSchema>

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const blockMetaSchema = z.strictObject({
  label: z.string().max(200),
  category: z.string().max(100).optional(),
  fields: fieldsSchema,
  defaultProps: z.record(z.string(), z.unknown()),
  data: z.record(z.string().regex(/^[A-Za-z_]\w*$/), querySpecSchema),
  propRefs: z.record(z.string(), z.array(z.string())),
  usesRequestParams: z.boolean(),
  slots: z.array(z.string()),
})
export type BlockMeta = z.infer<typeof blockMetaSchema>

export const manifestSchema = z
  .strictObject({
    artifactVersion: z.string().max(100),
    sdkMajor: z.literal(1, { message: 'artifact was built for an incompatible SDK major version; rebuild with the current @puck-remote/sdk' }),
    createdAt: z.string(),
    files: z.record(
      z.string().refine((p) => !p.split('/').some((s) => s === '..' || s === '.' || s === '') && !p.startsWith('/'), 'unsafe path'),
      z.string().regex(/^[0-9a-f]{64}$/),
    ),
    blocks: z.record(ident, blockMetaSchema),
    root: blockMetaSchema.nullable(),
    adapters: z.record(ident, z.strictObject({ origin })),
    categories: z.record(
      z.string(),
      z.strictObject({
        title: z.string().optional(),
        components: z.array(z.string()),
        defaultExpanded: z.boolean().optional(),
        visible: z.boolean().optional(),
      }),
    ),
  })
  .superRefine((m, ctx) => {
    if (!m.files['bundle.js']) ctx.addIssue({ code: 'custom', message: 'bundle.js missing from files' })
    const check = (name: string, b: BlockMeta) => {
      // Derived data must agree with the specs; the host recomputes rather than trusts.
      for (const [key, spec] of Object.entries(b.data)) {
        if (spec.source === 'adapter' && !m.adapters[spec.adapter]) ctx.addIssue({ code: 'custom', message: `${name}.data.${key}: unknown adapter` })
      }
      for (const s of b.slots) if (b.fields[s]?.type !== 'slot') ctx.addIssue({ code: 'custom', message: `${name}.slots: ${s} is not a slot field` })
    }
    for (const [n, b] of Object.entries(m.blocks)) check(n, b)
    if (m.root) check('root', m.root)
    for (const [k, c] of Object.entries(m.categories)) {
      for (const comp of c.components) if (!m.blocks[comp]) ctx.addIssue({ code: 'custom', message: `categories.${k}: unknown block ${comp}` })
    }
  })
export type Manifest = z.infer<typeof manifestSchema>

/** Recompute what the CLI claims, so the host never relies on CLI-provided analysis. */
export function analyzeSpecs(data: Record<string, QuerySpec>): { propRefs: Record<string, string[]>; usesRequestParams: boolean } {
  const propRefs: Record<string, string[]> = {}
  let usesRequestParams = false
  const walk = (v: unknown, acc: Set<string>) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, acc))
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (typeof o.$prop === 'string') acc.add(o.$prop)
    if (typeof o.$query === 'string') usesRequestParams = true
    for (const x of Object.values(o)) walk(x, acc)
  }
  for (const [k, spec] of Object.entries(data)) {
    const acc = new Set<string>()
    walk(spec, acc)
    propRefs[k] = [...acc].sort()
  }
  return { propRefs, usesRequestParams }
}
