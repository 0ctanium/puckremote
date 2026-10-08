/**
 * Artifact tests 19–20: tamper detection, publish by id, atomic pointer, hot swap, rollback.
 */
import { activate, publish } from '@puck-remote/cli'
import { appendFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { ArtifactLoader } from '../src/server/artifact-loader.ts'
import { IsolateRunner } from '../src/server/runtime/in-process.ts'
import { readArtifactFile } from '../src/server/static-files.ts'
import { buildEvil, buildExample, quietLog, testConfig } from './helpers.ts'

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

describe('19. tamper detection', () => {
  it('a hash mismatch is rejected and the previous artifact keeps serving', async () => {
    const { artifactsDir, store } = await setup()
    const { id: first } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    expect((await store.reload()).ok).toBe(true)
    expect(store.get().id).toBe(first)

    const { id: second } = await publish({ distDir: (await buildEvil()).outDir, artifacts: artifactsDir, quiet: true })
    await appendFile(path.join(artifactsDir, second, 'bundle.js'), '\n;globalThis.__pwned = 1')
    const r = await store.reload()
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.error).toMatch(/hash mismatch for bundle.js/)
    expect(store.get().id).toBe(first)
    expect(Object.keys(store.get().manifest.blocks)).toContain('latest-posts')
    store.close()
  })

  it('a tampered page is rejected like any other file', async () => {
    const { artifactsDir, store } = await setup()
    const { id } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    await appendFile(path.join(artifactsDir, id, 'pages', 'home.json'), ' ')
    const r = await store.reload()
    expect(!r.ok && r.error).toMatch(/hash mismatch for pages\/home.json/)
  })

  it('a tampered manifest (invalid schema / added block) is rejected', async () => {
    const { artifactsDir, store } = await setup()
    const { id: first } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    await store.reload()
    const { id: second } = await publish({ distDir: (await buildEvil()).outDir, artifacts: artifactsDir, quiet: true })
    const mf = path.join(artifactsDir, second, 'manifest.json')
    const m = JSON.parse(await readFile(mf, 'utf8'))
    m.blocks.probe.fields.evil = { type: 'external', fetchList: 'x' }
    await writeFile(mf, JSON.stringify(m))
    const r = await store.reload()
    expect(r.ok).toBe(false)
    expect(store.get().id).toBe(first)
    store.close()
  })

  it('tampered or non-public files are refused by the asset server', async () => {
    const { artifactsDir, artifacts } = await setup()
    const { id } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    expect(await readArtifactFile(artifacts, id, 'assets/theme.css')).not.toBeNull()
    expect(await readArtifactFile(artifacts, id, 'bundle.browser.js')).not.toBeNull()
    // The isolate bundle, the manifest and pages are never served.
    for (const hidden of ['bundle.js', 'manifest.json', 'pages/home.json']) expect(await readArtifactFile(artifacts, id, hidden), hidden).toBeNull()
    await appendFile(path.join(artifactsDir, id, 'assets', 'theme.css'), 'body{display:none}')
    expect(await readArtifactFile(artifacts, id, 'assets/theme.css')).toBeNull()
    for (const bad of ['../current.json', 'assets/../manifest.json', '/etc/passwd', 'assets//theme.css', 'assets\\theme.css']) {
      expect(await readArtifactFile(artifacts, id, bad), bad).toBeNull()
    }
    expect(await readArtifactFile(artifacts, `${id}/../${id}`, 'bundle.browser.js')).toBeNull()
  })
})

describe('20. publish, swap, rollback', () => {
  it('publish stores an artifact by id and atomically switches current.json; rollback is a pointer change', async () => {
    const { artifactsDir, store, disposed } = await setup()
    const ex = await buildExample()
    const evil = await buildEvil()
    const { id: a } = await publish({ distDir: ex.outDir, artifacts: artifactsDir, quiet: true })
    await store.reload()
    const firstRunner = (store.get().runtime as any).runner as IsolateRunner

    const { id: b } = await publish({ distDir: evil.outDir, artifacts: artifactsDir, quiet: true })
    expect(b).not.toBe(a)
    expect(JSON.parse(await readFile(path.join(artifactsDir, 'current.json'), 'utf8'))).toEqual({ id: b })
    expect(await store.reload()).toMatchObject({ ok: true, id: b, changed: true })
    expect(Object.keys(store.get().manifest.blocks)).toContain('probe')
    expect(disposed).toEqual([a]) // old isolate disposed after the swap
    await expect(firstRunner.session()).rejects.toThrow()

    // Rollback = point back at the first artifact. A fresh isolate is compiled for it.
    await activate(artifactsDir, a)
    expect(await store.reload()).toMatchObject({ ok: true, id: a })
    expect(Object.keys(store.get().manifest.blocks)).toContain('latest-posts')

    // Publishing identical content again gives the same id (stored once).
    expect((await publish({ distDir: ex.outDir, artifacts: artifactsDir, quiet: true })).id).toBe(a)
    expect((await readdir(artifactsDir)).filter((f) => f.includes('tmp'))).toEqual([])
    store.close()
  })

  it('readers never observe a partial current.json while it is being switched', async () => {
    const { artifactsDir, store } = await setup()
    const { id: a } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    const { id: b } = await publish({ distDir: (await buildEvil()).outDir, artifacts: artifactsDir, quiet: true })
    let stop = false
    let reads = 0
    const reader = (async () => {
      while (!stop) {
        const v = await store.readPointer() // throws on partial/invalid JSON
        expect([a, b]).toContain(v)
        reads++
      }
    })()
    for (let i = 0; i < 200; i++) await activate(artifactsDir, i % 2 ? a : b)
    stop = true
    await reader
    expect(reads).toBeGreaterThan(10)
  })

  it('a pointer to a missing artifact is rejected and the current one keeps serving', async () => {
    const { artifactsDir, store } = await setup()
    const { id } = await publish({ distDir: (await buildExample()).outDir, artifacts: artifactsDir, quiet: true })
    await store.reload()
    await writeFile(path.join(artifactsDir, 'current.json'), JSON.stringify({ id: 'f'.repeat(64) }))
    expect((await store.reload()).ok).toBe(false)
    await writeFile(path.join(artifactsDir, 'current.json'), '{"id": "../../etc"}')
    expect((await store.reload()).ok).toBe(false)
    expect(store.get().id).toBe(id)
    store.close()
  })
})
