/**
 * `@puck-remote/payload/source` — a DataSource over the Payload Local API.
 *
 * The source declares `requireRequest`: each query authenticates the request's Payload user
 * (session cookie or API key, once per request) and runs with `overrideAccess: false` as that user,
 * so Payload's collection- and field-level access rules apply. No request (or no session): the
 * anonymous user. Payload drafts (`draft: true`) are read only for users of the admin user
 * collection (`config.admin.user`) by default, i.e. the editor previewing as the logged-in user.
 *
 * Exposure stays an explicit allowlist (themes are untrusted): only the declared collections,
 * globals and fields are reachable, and the host core enforces that policy around every query.
 */
import type { CollectionField, CollectionDef, GlobalDef, NormalizedFind, NormalizedWhere, RawDoc, SourceContext } from '@puck-remote/sdk/host'
import type { Payload } from 'payload'

/** The shape of Payload's generated `Config` (payload-types.ts) this source reads doc types from. */
export interface PayloadTypes {
  collections: Record<string, unknown>
  globals: Record<string, unknown>
}

type Fields<D> = { [K in keyof D & string]?: CollectionField }

export interface PayloadCollectionOptions<D> {
  /** Exposed fields. Anything not listed is never selectable, filterable, sortable or returned. */
  fields: Fields<D>
  limits?: { default?: number; max?: number; maxDepth?: number }
}

export interface PayloadGlobalOptions<D> {
  /** Exposed fields; output is projected to these. */
  fields: Fields<D>
}

/** A Payload user as returned by `payload.auth` (`collection` is the auth collection's slug). */
export type PayloadUser = { id: string | number; collection: string } & Record<string, unknown>

export interface PayloadSourceOptions<T extends PayloadTypes, C, G> {
  /** The Payload instance, resolved lazily on the first query (e.g. `() => getPayload({ config })`). */
  payload: () => Payload | Promise<Payload>
  /** Exposed collections, by Payload slug. */
  collections: C & { [K in keyof C]: K extends keyof T['collections'] ? PayloadCollectionOptions<T['collections'][K]> : never }
  /** Exposed globals, by Payload slug. */
  globals?: G & { [K in keyof G]: K extends keyof T['globals'] ? PayloadGlobalOptions<T['globals'][K]> : never }
  /**
   * Whether a query reads Payload drafts (`draft: true`, the latest version the user may read).
   * Default: only for users of the admin user collection (`config.admin.user`).
   */
  draft?: (args: { user: PayloadUser | null; request: Request | null }) => boolean
}

const OPS: Record<string, string> = { equals: 'equals', in: 'in', contains: 'contains', gt: 'greater_than', lt: 'less_than' }

/** NormalizedWhere → Payload `Where`; null when nothing filters (a `contains null` matches all, like an empty search box). */
export function toPayloadWhere(w: NormalizedWhere | null): Record<string, unknown> | null {
  if (!w) return null
  if ('and' in w || 'or' in w) {
    const key = 'and' in w ? 'and' : 'or'
    const parts = ('and' in w ? w.and : w.or).map(toPayloadWhere)
    // In an `or`, a clause matching everything makes the whole condition match everything.
    if (key === 'or' && parts.some((p) => p === null)) return null
    const kept = parts.filter((p): p is Record<string, unknown> => p !== null)
    if (!kept.length) return null
    return kept.length === 1 ? kept[0] : { [key]: kept }
  }
  if (w.op === 'contains' && w.value === null) return null
  return { [w.field]: { [OPS[w.op]]: w.value } }
}

const toSelect = (select: string[] | null) => (select ? Object.fromEntries(select.map((f) => [f, true])) : undefined)

/**
 * `payloadSource<Config>()({ payload, collections, globals })`: `Config` is Payload's generated type
 * (payload-types.ts), which types each collection's documents for theme queries.
 */
export function payloadSource<T extends PayloadTypes = PayloadTypes>() {
  return <const C extends Record<string, PayloadCollectionOptions<any>>, const G extends Record<string, PayloadGlobalOptions<any>> = {}>(
    opts: PayloadSourceOptions<T, C, G>,
  ) => {
    let ready: Promise<Payload> | null = null
    // One authentication per request: every query of a page shares it.
    const users = new WeakMap<Request, Promise<PayloadUser | null>>()

    const instance = () =>
      (ready ??= Promise.resolve(opts.payload()).then((payload) => {
        validate(payload, opts.collections, opts.globals ?? {})
        return payload
      }))
    // A failed start (e.g. the database was down) is retried on the next query.
    const getPayload = () => instance().catch((e) => ((ready = null), Promise.reject(e)))

    const userOf = (payload: Payload, request: Request | null) => {
      if (!request) return Promise.resolve(null)
      let p = users.get(request)
      if (!p) {
        p = payload.auth({ headers: request.headers }).then((r) => (r.user as PayloadUser | null) ?? null)
        users.set(request, p)
      }
      return p
    }

    /** Who runs the query, whether it reads drafts and in which locale. */
    const access = async (ctx: SourceContext<true>) => {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error('aborted')
      const payload = await getPayload()
      const user = await userOf(payload, ctx.request)
      const draft = opts.draft ? opts.draft({ user, request: ctx.request }) : !!user && user.collection === payload.config.admin.user
      const locale = payload.config.localization ? { locale: ctx.locale as never } : {}
      return { payload, common: { user: user as never, overrideAccess: false, draft, ...locale } }
    }

    // Without drafts, published content only, whatever the app's access rules let the user read
    // (Payload keeps a never-published document in the collection with _status 'draft').
    const PUBLISHED = { _status: { equals: 'published' } }
    const hasDrafts = (versions: unknown) => !!(versions as { drafts?: unknown } | undefined)?.drafts
    const collectionDrafts = (payload: Payload, slug: string) => hasDrafts((payload.collections[slug as never] as { config: { versions?: unknown } }).config.versions)

    const collection = (slug: string, def: PayloadCollectionOptions<any>): CollectionDef<any, true> => ({
      fields: def.fields,
      limits: def.limits,
      find: async (q: NormalizedFind, ctx: SourceContext<true>) => {
        const { payload, common } = await access(ctx)
        const filter = toPayloadWhere(q.where)
        const published = !common.draft && collectionDrafts(payload, slug)
        const where = published ? (filter ? { and: [filter, PUBLISHED] } : PUBLISHED) : filter
        const res = await payload.find({
          collection: slug as never,
          ...common,
          ...(where ? { where: where as never } : {}),
          ...(q.sort ? { sort: (q.sort.direction === 'desc' ? '-' : '') + q.sort.field } : {}),
          ...(q.select ? { select: toSelect(q.select) as never } : {}),
          depth: q.depth,
          limit: q.limit,
          page: q.page,
          pagination: true,
        })
        return { docs: res.docs as RawDoc[], totalDocs: res.totalDocs }
      },
      findByID: async (id, q, ctx: SourceContext<true>) => {
        const { payload, common } = await access(ctx)
        if (!common.draft && collectionDrafts(payload, slug)) {
          const res = await payload.find({
            collection: slug as never,
            ...common,
            where: { and: [{ id: { equals: id } }, PUBLISHED] } as never,
            ...(q.select ? { select: toSelect(q.select) as never } : {}),
            depth: q.depth,
            limit: 1,
            pagination: false,
          })
          return (res.docs[0] as RawDoc | undefined) ?? null
        }
        const doc = await payload.findByID({
          collection: slug as never,
          id,
          ...common,
          ...(q.select ? { select: toSelect(q.select) as never } : {}),
          depth: q.depth,
          disableErrors: true,
        })
        return (doc as RawDoc | null) ?? null
      },
    })

    const global = (slug: string, def: PayloadGlobalOptions<any>): GlobalDef<any, true> => ({
      fields: def.fields,
      get: async (ctx: SourceContext<true>) => {
        const { payload, common } = await access(ctx)
        const doc = (await payload.findGlobal({ slug: slug as never, ...common, depth: 0 })) as RawDoc
        const config = payload.globals.config.find((g) => g.slug === slug)
        if (!common.draft && hasDrafts(config?.versions) && doc?._status !== 'published') return null
        return doc
      },
    })

    return {
      name: 'payload',
      requireRequest: true as const,
      collections: Object.fromEntries(Object.entries(opts.collections).map(([slug, def]) => [slug, collection(slug, def)])) as {
        [K in keyof C]: CollectionDef<K extends keyof T['collections'] ? T['collections'][K] : RawDoc, true>
      },
      globals: Object.fromEntries(Object.entries(opts.globals ?? {}).map(([slug, def]) => [slug, global(slug, def)])) as {
        [K in keyof G]: GlobalDef<K extends keyof T['globals'] ? T['globals'][K] : RawDoc, true>
      },
    }
  }
}

interface PayloadField {
  name?: string
  type: string
  relationTo?: string | string[]
}

/** Every declared collection, global and field must exist in the Payload config; relations must point where Payload's do. */
function validate(payload: Payload, collections: Record<string, PayloadCollectionOptions<any>>, globals: Record<string, PayloadGlobalOptions<any>>) {
  const check = (where: string, fields: PayloadField[], declared: Record<string, CollectionField | undefined>) => {
    for (const [name, f] of Object.entries(declared)) {
      if (!f) continue
      const pf = fields.find((x) => x.name === name)
      if (!pf) throw new Error(`[puck-remote/payload] ${where}: field "${name}" does not exist in Payload`)
      if (f.type !== 'relation') continue
      if (!f.to || !Object.hasOwn(collections, f.to)) throw new Error(`[puck-remote/payload] ${where}.${name}: relation target "${f.to}" is not an exposed collection`)
      const targets = pf.relationTo === undefined ? [] : Array.isArray(pf.relationTo) ? pf.relationTo : [pf.relationTo]
      if ((pf.type !== 'relationship' && pf.type !== 'upload') || !targets.includes(f.to))
        throw new Error(`[puck-remote/payload] ${where}.${name}: Payload field is not a relation to "${f.to}"`)
    }
  }
  for (const [slug, def] of Object.entries(collections)) {
    const c = payload.collections[slug as never] as { config: { flattenedFields: PayloadField[] } } | undefined
    if (!c) throw new Error(`[puck-remote/payload] collection "${slug}" does not exist in Payload`)
    check(`collection "${slug}"`, c.config.flattenedFields, def.fields)
  }
  for (const [slug, def] of Object.entries(globals)) {
    const g = payload.globals.config.find((x) => x.slug === slug) as { flattenedFields: PayloadField[] } | undefined
    if (!g) throw new Error(`[puck-remote/payload] global "${slug}" does not exist in Payload`)
    check(`global "${slug}"`, g.flattenedFields, def.fields)
  }
}
