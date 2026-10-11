/**
 * Theme rules (core): roles, one main theme, names, single-theme mode, expiry, retries, and the
 * write path (full and partial pushes, hash = sha256(manifest.json)).
 */
import type { ArtifactStore } from '@puck-remote/sdk/host'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/server/config.ts'
import { themeOps, type ThemeOps } from '../src/server/themes.ts'
import { buildExample, counterStore } from './helpers.ts'

const enc = new TextEncoder()
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Every file of the built example theme. */
async function exampleFiles(): Promise<Record<string, Uint8Array>> {
  const { outDir } = await buildExample()
  const out: Record<string, Uint8Array> = {}
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else out[path.relative(outDir, p).split(path.sep).join('/')] = new Uint8Array(await readFile(p))
    }
  }
  await walk(outDir)
  return out
}

/** The example's files with one file replaced (and the manifest updated). */
function withFile(files: Record<string, Uint8Array>, rel: string, content: string | null) {
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
  const next = { ...files }
  if (content === null) {
    delete next[rel]
    delete manifest.files[rel]
  } else {
    next[rel] = enc.encode(content)
    manifest.files[rel] = sha(next[rel])
  }
  next['manifest.json'] = enc.encode(JSON.stringify(manifest))
  return next
}

async function setup(themes: { multiple?: boolean; devExpiryDays?: number } = { multiple: true }) {
  const artifacts = counterStore()
  let now = new Date('2026-10-10T12:00:00.000Z')
  const onMainChange = vi.fn()
  const config = resolveConfig({ artifacts, source: {} as never, themes })
  const ops: ThemeOps = themeOps(config, { now: () => now, onMainChange })
  return { ops, artifacts, onMainChange, files: await exampleFiles(), tick: (days: number) => (now = new Date(now.getTime() + days * 86_400_000)) }
}

describe('themes', () => {
  it('creates empty themes with generated ids, dates and trimmed names', async () => {
    const { ops } = await setup()
    const main = await ops.create({ name: '  Dawn  ', role: 'main' })
    expect(main).toEqual({ id: expect.stringMatching(/^[0-9a-f]{12}$/), name: 'Dawn', role: 'main', hash: null, createdAt: '2026-10-10T12:00:00.000Z', updatedAt: '2026-10-10T12:00:00.000Z' })
    expect(await ops.main()).toEqual(main)
    expect(await ops.get('nope')).toBeNull()
  })

  it('refuses invalid names and roles, and a second main theme', async () => {
    const { ops } = await setup()
    await expect(ops.create({ name: '', role: 'main' })).rejects.toMatchObject({ status: 400 })
    await expect(ops.create({ name: 'x'.repeat(51), role: 'main' })).rejects.toThrow(/1 to 50 characters/)
    await expect(ops.create({ name: 'a\nb', role: 'main' })).rejects.toThrow(/control characters/)
    await expect(ops.create({ name: 'x', role: 'demo' as never })).rejects.toThrow(/invalid theme role/)
    await ops.create({ name: 'Main', role: 'main' })
    await expect(ops.create({ name: 'Other', role: 'main' })).rejects.toMatchObject({ status: 409 })
  })

  it('a full push stores the files; hash = sha256(manifest.json); the main theme reloads', async () => {
    const { ops, artifacts, files, onMainChange } = await setup()
    const t = await ops.create({ name: 'Main', role: 'main' })
    onMainChange.mockClear()
    const pushed = await ops.writeFiles(t.id, files)
    expect(pushed.hash).toBe(sha(files['manifest.json']))
    expect(onMainChange).toHaveBeenCalledTimes(1)
    expect(await artifacts.readFile(t.id, 'bundle.js')).toEqual(files['bundle.js'])
  })

  it('a partial push sends only changed files; unlisted files are removed; missing ones are refused', async () => {
    const { ops, artifacts, files } = await setup()
    const t = await ops.create({ name: 'Dev', role: 'development' })
    await ops.writeFiles(t.id, files)
    const changed = withFile(files, 'assets/new.css', 'a{}')
    const partial = { 'manifest.json': changed['manifest.json'], 'assets/new.css': changed['assets/new.css'] }
    const after = await ops.writeFiles(t.id, partial)
    expect(after.hash).toBe(sha(changed['manifest.json']))
    expect(new TextDecoder().decode((await artifacts.readFile(t.id, 'assets/new.css'))!)).toBe('a{}')
    expect(await artifacts.readFile(t.id, 'bundle.js')).toEqual(files['bundle.js'])

    const removed = withFile(changed, 'assets/new.css', null)
    await ops.writeFiles(t.id, { 'manifest.json': removed['manifest.json'] })
    expect(await artifacts.readFile(t.id, 'assets/new.css')).toBeNull()

    // A listed file that is neither uploaded nor unchanged in the theme.
    const other = withFile(removed, 'assets/other.css', 'b{}')
    await expect(ops.writeFiles(t.id, { 'manifest.json': other['manifest.json'] })).rejects.toThrow(/assets\/other.css is neither uploaded nor unchanged/)
    await expect(ops.writeFiles(t.id, { ...other, 'assets/other.css': enc.encode('tampered') })).rejects.toThrow(/hash mismatch for assets\/other.css/)
    await expect(ops.writeFiles(t.id, { ...removed, 'extra.js': enc.encode('x') })).rejects.toThrow(/extra.js is not listed/)
    await expect(ops.writeFiles(t.id, { 'bundle.js': files['bundle.js'] })).rejects.toThrow(/manifest.json is missing/)
    await expect(ops.writeFiles(t.id, { 'manifest.json': enc.encode('{"nope":1}') })).rejects.toMatchObject({ status: 400 })
  })

  it('expect must match the current hash (null: no files yet)', async () => {
    const { ops, files } = await setup()
    const t = await ops.create({ name: 'Dev', role: 'development' })
    await expect(ops.writeFiles(t.id, files, { expect: 'f'.repeat(64) })).rejects.toMatchObject({ status: 409 })
    const first = await ops.writeFiles(t.id, files, { expect: null })
    const next = withFile(files, 'assets/x.css', 'x')
    await expect(ops.writeFiles(t.id, next, { expect: null })).rejects.toMatchObject({ status: 409 })
    expect((await ops.writeFiles(t.id, next, { expect: first.hash! })).hash).toBe(sha(next['manifest.json']))
  })

  it('publish swaps the main theme and refuses themes without files', async () => {
    const { ops, files, onMainChange } = await setup()
    const main = await ops.create({ name: 'Main', role: 'main' })
    await ops.writeFiles(main.id, files)
    const next = await ops.create({ name: 'Next', role: 'unpublished' })
    await expect(ops.publish(next.id)).rejects.toThrow(`theme ${next.id} has no files yet`)
    await ops.writeFiles(next.id, withFile(files, 'assets/x.css', 'x'))
    onMainChange.mockClear()
    await ops.publish(next.id)
    expect(onMainChange).toHaveBeenCalledTimes(1)
    expect((await ops.get(next.id))?.role).toBe('main')
    expect((await ops.get(main.id))?.role).toBe('unpublished')
  })

  it('rename, delete (files too) and duplicate (files copied)', async () => {
    const { ops, artifacts, files } = await setup()
    const main = await ops.create({ name: 'Main', role: 'main' })
    await ops.writeFiles(main.id, files)
    expect((await ops.rename(main.id, 'Renamed')).name).toBe('Renamed')
    await expect(ops.delete(main.id)).rejects.toThrow(/main theme cannot be deleted/)
    const copy = await ops.duplicate(main.id)
    expect(copy).toMatchObject({ name: 'Copy of Renamed', role: 'unpublished', hash: sha(files['manifest.json']) })
    expect(await artifacts.readFile(copy.id, 'bundle.js')).toEqual(files['bundle.js'])
    await ops.delete(copy.id)
    expect(await ops.get(copy.id)).toBeNull()
    expect(await artifacts.readFile(copy.id, 'bundle.js')).toBeNull()
  })

  it('prune deletes development themes not updated for devExpiryDays, with their files', async () => {
    const { ops, artifacts, files, tick } = await setup({ multiple: true, devExpiryDays: 7 })
    await ops.create({ name: 'Main', role: 'main' })
    const old = await ops.create({ name: 'Development (aaaaaa-x)', role: 'development' })
    await ops.writeFiles(old.id, files)
    const unpublished = await ops.create({ name: 'Old draft', role: 'unpublished' })
    tick(6)
    const fresh = await ops.create({ name: 'Development (bbbbbb-y)', role: 'development' })
    expect(await ops.prune()).toEqual([])
    tick(1.5)
    expect(await ops.prune()).toEqual([old.id])
    expect(await artifacts.readFile(old.id, 'manifest.json')).toBeNull()
    expect((await ops.list()).map((t) => t.id).sort()).toEqual([(await ops.main())!.id, unpublished.id, fresh.id].sort())
  })

  it('single mode: one main theme, nothing else', async () => {
    const { ops, files } = await setup({})
    await expect(ops.create({ name: 'Dev', role: 'development' })).rejects.toThrow('this site has a single theme (themes.multiple is false)')
    const main = await ops.create({ name: 'Main', role: 'main' })
    await ops.writeFiles(main.id, files)
    await expect(ops.create({ name: 'Other', role: 'unpublished' })).rejects.toMatchObject({ status: 409 })
    await expect(ops.duplicate(main.id)).rejects.toMatchObject({ status: 409 })
    expect((await ops.publish(main.id)).id).toBe(main.id)
  })

  it('retries when another writer changed the list in between', async () => {
    const { ops, artifacts } = await setup()
    const store = artifacts as ArtifactStore
    const write = store.writeThemes.bind(store)
    let raced = false
    store.writeThemes = async (themes, opts) => {
      if (!raced) {
        raced = true
        // Someone else writes first: our version is stale.
        const cur = await store.readThemes()
        await write(cur.themes, { expect: cur.version })
      }
      return write(themes, opts)
    }
    expect((await ops.create({ name: 'Main', role: 'main' })).role).toBe('main')
    expect(raced).toBe(true)
  })
})
