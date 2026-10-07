/**
 * Artifact tests 19–20: tamper detection, versioned publish, atomic pointer, hot swap, rollback.
 */
import { activate, publish } from '@puck-remote/cli'
import { appendFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactStore } from '../src/server/artifact-loader.ts'
import { IsolateRunner } from '../src/server/isolate-runner.ts'
import { readArtifactFile } from '../src/server/static-files.ts'
import { buildEvil, buildExample, quietLog, testConfig } from './helpers.ts'

async function setup() {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-art-'))
  const disposed: number[] = []
  const store = new ArtifactStore({
    artifactsDir,
    log: quietLog,
    createRuntime: ({ version, bundle }) => {
      const runner = new IsolateRunner(bundle, testConfig().isolate, quietLog)
      return { runner, version, dispose: () => (disposed.push(version), runner.dispose()) }
    },
  })
  return { artifactsDir, store, disposed }
}

describe('19. tamper detection', () => {
  it('a hash mismatch is rejected and the previous version keeps serving', async () => {
    const { artifactsDir, store } = await setup()
    await publish({ distDir: (await buildExample()).outDir, artifactsDir, quiet: true })
    expect((await store.reload()).ok).toBe(true)
    expect(store.get().version).toBe(1)

    await publish({ distDir: (await buildEvil()).outDir, artifactsDir, quiet: true })
    await appendFile(path.join(artifactsDir, 'v2', 'bundle.js'), '\n;globalThis.__pwned = 1')
    const r = await store.reload()
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.error).toMatch(/hash mismatch for bundle.js/)
    expect(store.get().version).toBe(1)
    expect(Object.keys(store.get().manifest.blocks)).toContain('latest-posts')
    store.close()
  })

  it('a tampered manifest (invalid schema / added block) is rejected', async () => {
    const { artifactsDir, store } = await setup()
    await publish({ distDir: (await buildExample()).outDir, artifactsDir, quiet: true })
    await store.reload()
    await publish({ distDir: (await buildExample()).outDir, artifactsDir, quiet: true })
    const mf = path.join(artifactsDir, 'v2', 'manifest.json')
    const m = JSON.parse(await readFile(mf, 'utf8'))
    m.blocks.hero.fields.evil = { type: 'external', fetchList: 'x' }
    await writeFile(mf, JSON.stringify(m))
    const r = await store.reload()
    expect(r.ok).toBe(false)
    expect(store.get().version).toBe(1)
    store.close()
  })

  it('tampered assets are refused by the asset server', async () => {
    const { artifactsDir } = await setup()
    await publish({ distDir: (await buildExample()).outDir, artifactsDir, quiet: true })
    expect(await readArtifactFile(artifactsDir, 'v1', 'assets/theme.css')).not.toBeNull()
    await appendFile(path.join(artifactsDir, 'v1', 'assets', 'theme.css'), 'body{display:none}')
    expect(await readArtifactFile(artifactsDir, 'v1', 'assets/theme.css')).toBeNull()
    for (const bad of ['../current.json', 'assets/../manifest.json', '/etc/passwd', 'assets//theme.css', 'assets\\theme.css']) {
      expect(await readArtifactFile(artifactsDir, 'v1', bad), bad).toBeNull()
    }
    expect(await readArtifactFile(artifactsDir, 'v1/../v1', 'bundle.js')).toBeNull()
  })
})

describe('20. publish, swap, rollback', () => {
  it('publish increments the version and atomically switches current.json; rollback is a pointer change', async () => {
    const { artifactsDir, store, disposed } = await setup()
    const ex = await buildExample()
    const evil = await buildEvil()
    expect((await publish({ distDir: ex.outDir, artifactsDir, quiet: true })).version).toBe(1)
    await store.reload()
    const v1Runner = (store.get().runtime as any).runner as IsolateRunner

    expect((await publish({ distDir: evil.outDir, artifactsDir, quiet: true })).version).toBe(2)
    expect(JSON.parse(await readFile(path.join(artifactsDir, 'current.json'), 'utf8'))).toEqual({ version: 2 })
    expect(await store.reload()).toMatchObject({ ok: true, version: 2, changed: true })
    expect(Object.keys(store.get().manifest.blocks)).toContain('probe')
    expect(disposed).toEqual([1]) // old isolate disposed after the swap
    await expect(v1Runner.session()).rejects.toThrow()

    // Rollback = point back at v1. A fresh isolate is compiled for it.
    await activate(artifactsDir, 1)
    expect(await store.reload()).toMatchObject({ ok: true, version: 1 })
    expect(Object.keys(store.get().manifest.blocks)).toContain('latest-posts')

    // Next publish never reuses a number, even after a rollback.
    expect((await publish({ distDir: ex.outDir, artifactsDir, quiet: true })).version).toBe(3)
    expect((await readdir(artifactsDir)).filter((f) => f.includes('tmp'))).toEqual([])
    store.close()
  })

  it('readers never observe a partial current.json while it is being switched', async () => {
    const { artifactsDir, store } = await setup()
    const ex = await buildExample()
    await publish({ distDir: ex.outDir, artifactsDir, quiet: true })
    await publish({ distDir: ex.outDir, artifactsDir, quiet: true })
    let stop = false
    let reads = 0
    const reader = (async () => {
      while (!stop) {
        const v = await store.readPointer() // throws on partial/invalid JSON
        expect([1, 2]).toContain(v)
        reads++
      }
    })()
    for (let i = 0; i < 200; i++) await activate(artifactsDir, (i % 2) + 1)
    stop = true
    await reader
    expect(reads).toBeGreaterThan(10)
  })

  it('a pointer to a missing version is rejected and the current one keeps serving', async () => {
    const { artifactsDir, store } = await setup()
    await publish({ distDir: (await buildExample()).outDir, artifactsDir, quiet: true })
    await store.reload()
    await writeFile(path.join(artifactsDir, 'current.json'), JSON.stringify({ version: 42 }))
    expect((await store.reload()).ok).toBe(false)
    await writeFile(path.join(artifactsDir, 'current.json'), '{"version": "1; rm -rf /"}')
    expect((await store.reload()).ok).toBe(false)
    expect(store.get().version).toBe(1)
    store.close()
  })
})
