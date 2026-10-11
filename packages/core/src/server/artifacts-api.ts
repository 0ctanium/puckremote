/**
 * The artifacts API, mounted by the app at `routes.api` on host origins: the CLI manages themes
 * and pushes their files through it, whatever ArtifactStore the app uses. Every request goes
 * through the app's `authorize` first (required: no authorize, no API). Paths are relative to
 * the route (default `/api/themes`):
 *
 *   GET    /                         → { themes, multiple }
 *   POST   / { name, role }          → 201 { theme }   (a theme without files)
 *   GET    /<id>                     → { theme, previewUrl? }
 *   PATCH  /<id> { name }            → { theme, previewUrl? }
 *   DELETE /<id>                     → { ok: true }   (the main theme cannot be deleted)
 *   POST   /<id>/publish             → { theme }
 *   POST   /<id>/duplicate { name? } → 201 { theme, previewUrl? }
 *   POST   /<id>/files?expect=<hash> package (.tar.gz, full or only changed files + manifest.json)
 *                                    → { theme, previewUrl? }   (409 when expect does not match)
 *   GET    /<id>/files/<path>        → file bytes
 */
import type { ApiAction, AuthorizeApi, Theme } from '@puck-remote/sdk/host'
import type { HostConfig } from './config.ts'
import { PackageError, unpackPackage } from './package.ts'
import { previewUrl } from './preview.ts'
import { isThemeId, ThemeError, type ThemeOps } from './themes.ts'

export interface ArtifactsApiOptions {
  /** Decides whether a request may perform an action (e.g. checks a bearer token). Required. */
  authorize: AuthorizeApi
}

const MAX_JSON_BYTES = 4096

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const error = (status: number, message: string) => json(status, { error: message })

const isSafeRel = (rel: string) =>
  !!rel && !rel.startsWith('/') && !rel.includes('\\') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '')

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** The request body, refusing to read more than `max` bytes. */
async function readBody(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new ApiError(413, `body larger than ${max} bytes`)
  if (!request.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new ApiError(413, `body larger than ${max} bytes`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.byteLength
  }
  return out
}

type Route =
  | { action: ApiAction; run: () => Promise<Response> }
  | { status: 404 | 405; allow?: string }

/** A small JSON body (theme requests), or an ApiError. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readBody(request, MAX_JSON_BYTES)
  try {
    const v = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {}
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {}
  throw new ApiError(400, 'body must be a JSON object')
}

const actionTheme = (t: Theme) => ({ id: t.id, name: t.name, role: t.role })

export async function handleArtifactsApi(
  config: HostConfig,
  themes: ThemeOps,
  sub: string | null,
  request: Request,
  opts: ArtifactsApiOptions,
): Promise<Response> {
  if (typeof opts?.authorize !== 'function') return error(500, 'artifacts API: authorize is not configured')
  const store = config.artifacts
  const parts = (sub ?? '').split('/').filter(Boolean)
  const method = request.method
  const withPreview = (theme: Theme, status = 200) => {
    const url = previewUrl(config, theme)
    return json(status, url ? { theme, previewUrl: url } : { theme })
  }

  const route = async (): Promise<Route> => {
    if (sub === null) return { status: 404 }
    const [id, op, ...rest] = parts
    if (!id) {
      if (method === 'GET')
        return {
          action: { kind: 'list' },
          run: async () => {
            await themes.prune()
            return json(200, { themes: await themes.list(), multiple: config.themes.multiple })
          },
        }
      if (method === 'POST') {
        // Small JSON, read first so authorize sees the requested name and role.
        const body = await readJson(request)
        const name = typeof body.name === 'string' ? body.name : ''
        const role = body.role as Theme['role']
        return {
          action: { kind: 'createTheme', theme: { name, role } },
          run: async () => {
            await themes.prune()
            return json(201, { theme: await themes.create({ name, role }) })
          },
        }
      }
      return { status: 405, allow: 'GET, POST' }
    }
    if (!isThemeId(id)) return { status: 404 }
    const theme = await themes.get(id)
    const target = theme ? actionTheme(theme) : undefined
    const notFound = async () => error(404, `theme ${id} not found`)
    if (op === 'files') {
      if (rest.length) {
        if (method !== 'GET') return { status: 405, allow: 'GET' }
        return {
          action: { kind: 'read', theme: target },
          run: async () => {
            const rel = rest.join('/')
            const bytes = theme && isSafeRel(rel) ? await store.readFile(id, rel) : null
            if (!bytes) return error(404, 'not found')
            return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } })
          },
        }
      }
      if (method !== 'POST') return { status: 405, allow: 'POST' }
      return {
        action: { kind: 'updateTheme', theme: target },
        run: async () => {
          if (!theme) return notFound()
          const expect = new URL(request.url).searchParams.get('expect')
          if (expect !== null && !/^[0-9a-f]{64}$/.test(expect)) throw new ApiError(400, 'invalid expect')
          const bytes = await readBody(request, config.api.maxPackageBytes)
          const files = await unpackPackage(bytes, config.api)
          return withPreview(await themes.writeFiles(id, files, expect === null ? {} : { expect }))
        },
      }
    }
    if (op === 'publish' || op === 'duplicate') {
      if (rest.length) return { status: 404 }
      if (method !== 'POST') return { status: 405, allow: 'POST' }
      if (op === 'publish')
        return { action: { kind: 'publishTheme', theme: target }, run: async () => (theme ? json(200, { theme: await themes.publish(id) }) : notFound()) }
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name : undefined
      return {
        action: { kind: 'createTheme', theme: { name: name ?? `Copy of ${theme?.name ?? ''}`, role: 'unpublished' } },
        run: async () => (theme ? withPreview(await themes.duplicate(id, name === undefined ? {} : { name }), 201) : notFound()),
      }
    }
    if (op !== undefined) return { status: 404 }
    if (method === 'GET') return { action: { kind: 'read', theme: target }, run: async () => (theme ? withPreview(theme) : notFound()) }
    if (method === 'DELETE')
      return {
        action: { kind: 'deleteTheme', theme: target },
        run: async () => {
          if (!theme) return notFound()
          await themes.delete(id)
          return json(200, { ok: true })
        },
      }
    if (method === 'PATCH')
      return {
        action: { kind: 'updateTheme', theme: target },
        run: async () => {
          if (!theme) return notFound()
          const { name } = await readJson(request)
          if (typeof name !== 'string') throw new ApiError(400, 'body must be JSON { name }')
          return withPreview(await themes.rename(id, name))
        },
      }
    return { status: 405, allow: 'GET, PATCH, DELETE' }
  }

  let r: Route
  try {
    r = await route()
  } catch (e) {
    if (e instanceof ApiError) return error(e.status, e.message)
    throw e
  }
  if ('status' in r) {
    const res = error(r.status, r.status === 404 ? 'not found' : 'method not allowed')
    if (r.allow) res.headers.set('allow', r.allow)
    return res
  }
  // Authorization comes before running anything, and before reading any package body.
  if (!(await opts.authorize(request, r.action))) return error(401, 'unauthorized')
  try {
    return await r.run()
  } catch (e) {
    if (e instanceof ApiError) return error(e.status, e.message)
    if (e instanceof PackageError) return error(e.status, e.message)
    if (e instanceof ThemeError) return error(e.status, e.message)
    if ((e as { code?: string })?.code === 'THEME_CONFLICT') return error(409, (e as Error).message)
    throw e
  }
}
