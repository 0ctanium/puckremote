/**
 * Artifacts API (routes.api): authorization, themes, pushing theme files (full and partial,
 * verified, limits), reading theme files.
 */
import { packDist } from '@puck-remote/cli'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import type { ApiAction } from '@puck-remote/sdk/host'
import { createHash } from 'node:crypto'
import { appendFile, cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { handleArtifactsApi } from '../src/server/artifacts-api.ts'
import { resolveConfig, type HostConfig } from '../src/server/config.ts'
import { verifyPreviewToken } from '../src/server/preview.ts'
import { themeOps } from '../src/server/themes.ts'
import { buildExample } from './helpers.ts'

const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), `puck-remote-${p}-`))
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')

async function setup(overrides: Partial<HostConfig> = {}, multiple = true) {
  const artifacts = fsArtifactStore({ dir: path.join(await tmp('api'), 'artifacts') })
  const config = {
    ...resolveConfig({
      artifacts,
      source: { collections: {}, globals: {} } as never,
      origins: { host: ['https://admin.example.com'], editor: 'https://editor.example.net', site: 'https://www.example.com' },
      preview: { secret: 'test-secret' },
      themes: { multiple },
    }),
    ...overrides,
  }
  const actions: ApiAction[] = []
  let mainChanges = 0
  const themes = themeOps(config, { onMainChange: () => void mainChanges++ })
  const call = (method: string, sub: string, body?: BodyInit, authorize = async (_r: Request, a: ApiAction) => (actions.push(a), true)) =>
    // Like the core: the route is the URL's path, the query stays on the request.
    handleArtifactsApi(config, themes, sub.split('?')[0], new Request(`https://admin.example.com/api/themes/${sub}`, { method, body }), { authorize })
  const json = async (method: string, sub: string, body?: unknown) => {
    const res = await call(method, sub, body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
    return { status: res.status, body: await res.json() }
  }
  const create = (name: string, role: string) => json('POST', '', { name, role })
  const push = async (id: string, pkg: Uint8Array, expect?: string) => {
    const res = await call('POST', `${id}/files${expect ? `?expect=${expect}` : ''}`, new Uint8Array(pkg))
    return { status: res.status, body: await res.json() }
  }
  return { config, artifacts, themes, call, json, create, push, actions, mainChanges: () => mainChanges }
}

/** A copy of the example dist, changed by `edit`. */
async function dist(edit?: (dir: string) => Promise<void>) {
  const dir = await tmp('dist')
  await cp((await buildExample()).outDir, dir, { recursive: true })
  await edit?.(dir)
  return dir
}
/** That copy packaged: whole, or only `only`. */
const pkg = async (edit?: (dir: string) => Promise<void>, only?: string[]) => packDist(await dist(edit), only)

/** Add or replace a file in a dist copy, keeping the manifest in sync. */
async function putFile(dir: string, rel: string, content: string) {
  await writeFile(path.join(dir, rel), content)
  const file = path.join(dir, 'manifest.json')
  const m = JSON.parse(await readFile(file, 'utf8'))
  m.files[rel] = sha(content)
  await writeFile(file, JSON.stringify(m))
}

describe('artifacts API: authorization', () => {
  it('refuses everything without authorize, and with authorize returning false', async () => {
    const { config, call, themes } = await setup()
    const res = await handleArtifactsApi(config, themes, '', new Request('https://admin.example.com/api/themes'), {} as never)
    expect(res.status).toBe(500)
    const denied = await call('GET', '', undefined, async () => false)
    expect(denied.status).toBe(401)
    expect(await denied.json()).toEqual({ error: 'unauthorized' })
  })

  it('passes the action (and theme) to authorize, before reading any package body', async () => {
    const { call, create, push, actions } = await setup()
    const { body } = await create('Dev', 'development')
    const id = body.theme.id
    await push(id, await pkg())
    await call('GET', '')
    await call('GET', `${id}`)
    await call('GET', `${id}/files/manifest.json`)
    await call('PATCH', `${id}`, '{"name":"Dev 2"}')
    await call('POST', `${id}/duplicate`, '{}')
    await call('POST', `${id}/publish`)
    await call('DELETE', 'aaaaaaaaaaaa')
    const t = { id, name: 'Dev', role: 'development' }
    expect(actions).toEqual([
      { kind: 'createTheme', theme: { name: 'Dev', role: 'development' } },
      { kind: 'updateTheme', theme: t },
      { kind: 'list' },
      { kind: 'read', theme: t },
      { kind: 'read', theme: t },
      { kind: 'updateTheme', theme: t },
      { kind: 'createTheme', theme: { name: 'Copy of Dev 2', role: 'unpublished' } },
      { kind: 'publishTheme', theme: { ...t, name: 'Dev 2' } },
      { kind: 'deleteTheme', theme: undefined },
    ])
    let read = false
    const stream = new ReadableStream({ pull: () => void (read = true) }, { highWaterMark: 0 })
    const s2 = await setup()
    const other = (await s2.create('X', 'development')).body.theme.id
    const res = await handleArtifactsApi(s2.config, s2.themes, `${other}/files`, new Request('https://admin.example.com/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit), { authorize: () => false })
    expect(res.status).toBe(401)
    expect(read).toBe(false)
  })

  it('answers 404 / 405 for unknown routes and methods', async () => {
    const { call } = await setup()
    expect((await call('GET', 'nope')).status).toBe(404)
    expect((await call('GET', 'themes')).status).toBe(404)
    // The route itself, with or without a trailing slash, lists the themes.
    expect((await call('GET', '/')).status).toBe(200)
    expect((await call('GET', 'Bad_Name')).status).toBe(404)
    expect((await call('POST', 'aaaaaaaaaaaa/nope')).status).toBe(404)
    const r = await call('PUT', 'aaaaaaaaaaaa')
    expect(r.status).toBe(405)
    expect(r.headers.get('allow')).toBe('GET, PATCH, DELETE')
    expect((await call('GET', 'aaaaaaaaaaaa/files')).headers.get('allow')).toBe('POST')
  })
})

describe('artifacts API: theme files', () => {
  it('a full push stores the files; hash = sha256(manifest.json); files are readable', async () => {
    const { create, push, call, artifacts, mainChanges } = await setup()
    const { body } = await create('Dawn', 'main')
    expect(body.theme.hash).toBeNull()
    const d = await dist()
    const r = await push(body.theme.id, await packDist(d))
    expect(r.status).toBe(200)
    expect(r.body.theme.hash).toBe(sha(await readFile(path.join(d, 'manifest.json'))))
    expect(mainChanges()).toBe(1)
    const manifest = await call('GET', `${body.theme.id}/files/manifest.json`)
    expect(manifest.headers.get('content-type')).toBe('application/octet-stream')
    expect(JSON.parse(await manifest.text()).files['bundle.js']).toBeTruthy()
    expect((await call('GET', `${body.theme.id}/files/missing.json`)).status).toBe(404)
    expect((await call('GET', `${body.theme.id}/files/../themes.json`)).status).toBe(404)
    expect(await artifacts.readFile(body.theme.id, 'assets/theme.css')).not.toBeNull()
  })

  it('a partial push sends only changed files; expect protects against concurrent changes', async () => {
    const { create, push } = await setup()
    const { body } = await create('Dev', 'development')
    const id = body.theme.id
    const first = await push(id, await pkg())
    const d = await dist((dir) => putFile(dir, 'assets/new.css', 'a{}'))
    const partial = await push(id, await packDist(d, ['assets/new.css', 'manifest.json']), first.body.theme.hash)
    expect(partial.status).toBe(200)
    expect(partial.body.previewUrl).toMatch(/^https:\/\/www\.example\.com\/theme\/preview\?token=/)
    // The same base again: 409.
    const stale = await push(id, await packDist(d, ['manifest.json']), first.body.theme.hash)
    expect(stale.status).toBe(409)
    expect((await push(id, await packDist(d, ['manifest.json']), 'nope')).status).toBe(400)
  })

  it('rejects mismatched, unlisted, missing files and invalid packages', async () => {
    const { create, push } = await setup()
    const { body } = await create('Dev', 'development')
    const id = body.theme.id
    expect(await push(id, await pkg((d) => appendFile(path.join(d, 'bundle.js'), '\n;x')))).toEqual({ status: 400, body: { error: 'upload: hash mismatch for bundle.js' } })
    expect(await push(id, await pkg((d) => writeFile(path.join(d, 'extra.js'), 'x')))).toEqual({ status: 400, body: { error: 'upload: extra.js is not listed in manifest.files' } })
    // A partial push to a theme without files: the rest is missing.
    expect((await push(id, await pkg(undefined, ['manifest.json']))).body.error).toMatch(/is neither uploaded nor unchanged/)
    expect((await push(id, await pkg((d) => writeFile(path.join(d, 'manifest.json'), '{"nope":1}')))).status).toBe(400)
    expect(await push(id, new TextEncoder().encode('hello'))).toEqual({ status: 400, body: { error: 'package is not a gzip-compressed tar' } })
    expect((await push(id, gzipSync('not a tar at all'.repeat(100)))).status).toBe(400)
    expect((await push('aaaaaaaaaaaa', await pkg())).status).toBe(404)
  })

  it('enforces size and file count limits with 413', async () => {
    const bytes = await pkg()
    for (const [api, msg] of [
      [{ maxPackageBytes: 100 }, 'body larger than 100 bytes'],
      [{ maxUnpackedBytes: 1000 }, null],
      [{ maxFiles: 2 }, 'package has more than 2 files'],
    ] as const) {
      const s = await setup()
      s.config.api = { ...s.config.api, ...api }
      const { body } = await s.create('Dev', 'development')
      const r = await s.push(body.theme.id, bytes)
      expect(r.status).toBe(413)
      if (msg) expect(r.body.error).toBe(msg)
    }
  })
})

describe('artifacts API: themes', () => {
  it('lists, renames, publishes, duplicates and deletes themes; preview links for non-main themes with files', async () => {
    const { json, create, push, config, artifacts } = await setup()
    const main = (await create('Dawn', 'main')).body.theme
    await push(main.id, await pkg())
    const dev = (await create('Development (a1b2c3-mac)', 'development')).body.theme
    expect((await json('GET', `${dev.id}`)).body.previewUrl).toBeUndefined() // no files yet
    const pushed = (await push(dev.id, await pkg())).body
    expect(verifyPreviewToken(config.preview!, new URL(pushed.previewUrl).searchParams.get('token'))?.theme).toBe(dev.id)
    const listed = (await json('GET', '')).body
    expect(listed.multiple).toBe(true)
    expect(listed.themes.map((t: { name: string }) => t.name)).toEqual(['Dawn', 'Development (a1b2c3-mac)'])
    expect((await json('PATCH', `${dev.id}`, { name: 'Renamed' })).body.theme.name).toBe('Renamed')
    expect((await json('PATCH', `${dev.id}`, { name: '' })).status).toBe(400)
    expect((await json('PATCH', `${dev.id}`, 'nope')).status).toBe(400)

    const copy = await json('POST', `${main.id}/duplicate`, { name: 'Summer' })
    expect(copy.status).toBe(201)
    expect(copy.body.theme).toMatchObject({ name: 'Summer', role: 'unpublished', hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(await artifacts.readFile(copy.body.theme.id, 'bundle.js')).not.toBeNull()
    const empty = (await create('Empty', 'unpublished')).body.theme
    expect((await json('POST', `${empty.id}/publish`)).body).toEqual({ error: `theme ${empty.id} has no files yet` })
    expect((await json('POST', `${copy.body.theme.id}/publish`)).body.theme.role).toBe('main')

    expect(await json('DELETE', `${copy.body.theme.id}`)).toEqual({ status: 400, body: { error: 'the main theme cannot be deleted' } })
    expect((await json('DELETE', `${dev.id}`)).body).toEqual({ ok: true })
    expect(await artifacts.readFile(dev.id, 'manifest.json')).toBeNull()
    expect((await json('GET', `${dev.id}`)).status).toBe(404)
  })

  it('prunes expired development themes before listing', async () => {
    const { json, create, artifacts } = await setup()
    await create('Development (a1b2c3-mac)', 'development')
    const list = await artifacts.readThemes()
    await artifacts.writeThemes(list.themes.map((t) => ({ ...t, updatedAt: '2020-01-01T00:00:00.000Z' })), { expect: list.version })
    expect((await json('GET', '')).body.themes).toEqual([])
  })

  it('single mode: only a main theme, no preview links', async () => {
    const { create, push, json } = await setup({}, false)
    expect(await create('Dev', 'development')).toEqual({ status: 409, body: { error: 'this site has a single theme (themes.multiple is false)' } })
    const main = (await create('Main', 'main')).body.theme
    expect((await push(main.id, await pkg())).body.previewUrl).toBeUndefined()
    expect((await json('GET', '')).body.multiple).toBe(false)
    expect((await json('POST', `${main.id}/duplicate`, {})).status).toBe(409)
  })
})
