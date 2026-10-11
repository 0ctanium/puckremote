/**
 * Loader tests 19–20: invalid manifests rejected (the previous version keeps serving), the main
 * theme's version swap, theme files server (versions across themes, no-cache on mismatch).
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { ArtifactLoader } from '../src/server/artifact-loader.ts'
import { IsolateRunner } from '../src/server/runtime/in-process.ts'
import { ThemeFiles } from '../src/server/static-files.ts'
import { themeVersion } from '../src/shared/urls.ts'
import { buildEvil, buildExample, publish, quietLog, testConfig } from './helpers.ts'

async function setup() {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-art-'))
  const disposed: string[] = []
  const artifacts = fsArtifactStore({ dir: artifactsDir })
  const store = new ArtifactLoader({
    artifacts,
    log: quietLog,
    createRuntime: ({ id, bundle }) => {
      const runner = new IsolateRunner(bundle, testConfig().isolate, quietLog)
      return { runner, id, dispose: () => (disposed.push(id), runner.dispose()) }
    },
  })
  return { artifactsDir, artifacts, store, disposed }
}

describe('19. invalid theme versions', () => {
  it('an invalid manifest (schema, added block) is rejected and the previous version keeps serving', async () => {
    const { artifactsDir, store } = await setup()
    const first = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir })
    expect((await store.reload()).ok).toBe(true)
    const second = await publish({ distDir: (await buildEvil()).outDir, artifacts: artifactsDir })
    const mf = path.join(artifactsDir, 'themes', second.theme, 'manifest.json')
    const m = JSON.parse(await readFile(mf, 'utf8'))
    m.blocks.probe.fields.evil = { type: 'external', fetchList: 'x' }
    await writeFile(mf, JSON.stringify(m))
    const r = await store.reload({ force: true })
    expect(r.ok).toBe(false)
    expect(store.get().id).toBe(first.id)
    store.close()
  })

  it('a main theme without files (or without bundle.js) is rejected', async () => {
    const { artifactsDir, artifacts, store } = await setup()
    await artifacts.writeThemes([{ id: 'aaaaaaaaaaaa', name: 'Main', role: 'main', hash: null, createdAt: '', updatedAt: '' }], { expect: 'none' })
    expect(await store.reload()).toEqual({ ok: false, error: 'main theme aaaaaaaaaaaa has no files yet' })
    const { theme } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, theme: 'aaaaaaaaaaaa' })
    await artifacts.writeFiles(theme, { delete: ['bundle.js'] })
    const r = await store.reload()
    expect(!r.ok && r.error).toMatch(/bundle.js missing/)
  })
})

describe('20. versions, swap', () => {
  it('a push changes the main theme’s hash; the loader swaps to it and disposes the old runtime', async () => {
    const { artifactsDir, store, disposed } = await setup()
    const a = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir })
    await store.reload()
    expect(store.get()).toMatchObject({ id: a.id, theme: a.theme, hash: a.hash })
    const firstRunner = (store.get().runtime as any).runner as IsolateRunner
    expect(await store.reload()).toMatchObject({ ok: true, changed: false })

    const b = await publish({ distDir: (await buildEvil()).outDir, artifacts: artifactsDir })
    expect(b.theme).toBe(a.theme)
    expect(b.hash).not.toBe(a.hash)
    expect(await store.reload()).toMatchObject({ ok: true, id: b.id, changed: true })
    expect(Object.keys(store.get().manifest.blocks)).toContain('probe')
    expect(disposed).toEqual([a.id])
    await expect(firstRunner.session()).rejects.toThrow()
    store.close()
  })
})

describe('theme files (assets and bundles)', () => {
  it('serves a version from the main theme or any theme listing it; mismatching bytes are no-cache', async () => {
    const { artifactsDir, artifacts } = await setup()
    const ex = (await buildExample()).outDir
    const main = await publish({ distDir: ex, artifacts: artifactsDir })
    const files = new ThemeFiles(artifacts)
    const css = JSON.parse(await readFile(path.join(ex, 'manifest.json'), 'utf8')).files['assets/theme.css'] as string
    const v = themeVersion(css)

    const hit = await files.get('assets/theme.css', v)
    expect(hit?.immutable).toBe(true)
    // No or unknown v: the main theme's file, revalidated.
    expect((await files.get('assets/theme.css', null))?.immutable).toBe(false)
    expect((await files.get('assets/theme.css', 'ffffffffffff'))?.immutable).toBe(false)
    // Never served: the isolate bundle, the manifest, templates, traversal.
    for (const hidden of ['bundle.js', 'manifest.json', 'templates/home.json', '../themes.json', 'assets/../manifest.json']) expect(await files.get(hidden, null), hidden).toBeNull()

    // Another theme's version (a preview) is found by its v.
    const dev = await publish({ distDir: ex, artifacts: artifactsDir, role: 'development' })
    const devCss = 'body{color:red}'
    const manifest = JSON.parse(await readFile(path.join(artifactsDir, 'themes', dev.theme, 'manifest.json'), 'utf8'))
    const { createHash } = await import('node:crypto')
    const devSha = createHash('sha256').update(devCss).digest('hex')
    manifest.files['assets/theme.css'] = devSha
    const mbytes = new TextEncoder().encode(JSON.stringify(manifest))
    await artifacts.writeFiles(dev.theme, { put: { 'assets/theme.css': new TextEncoder().encode(devCss), 'manifest.json': mbytes } })
    const list = await artifacts.readThemes()
    await artifacts.writeThemes(list.themes.map((t) => (t.id === dev.theme ? { ...t, hash: createHash('sha256').update(mbytes).digest('hex') } : t)), { expect: list.version })
    const devHit = await files.get('assets/theme.css', themeVersion(devSha))
    expect(devHit?.immutable).toBe(true)
    expect(new TextDecoder().decode(devHit!.file.body)).toBe(devCss)

    // Written in place: bytes that no longer match the requested v are never immutable.
    await artifacts.writeFiles(main.theme, { put: { 'assets/theme.css': new TextEncoder().encode('changed') } })
    const stale = await files.get('assets/theme.css', v)
    expect(stale?.immutable).toBe(false)
    expect(new TextDecoder().decode(stale!.file.body)).toBe('changed')
  })
})
