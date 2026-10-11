/** Built-in adapters pass the same contract suite third-party adapters are given. */
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactStoreContract } from '../src/testing/index.ts'
import type { Theme } from '@puck-remote/sdk/host'
import { counterStore } from './helpers.ts'

const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), `puck-remote-${p}-`))
const bytes = (s: string) => new TextEncoder().encode(s)

artifactStoreContract('fs', async () => fsArtifactStore({ dir: path.join(await tmp('art'), 'artifacts') }))
artifactStoreContract('in-memory (test store)', () => counterStore())

describe('fsArtifactStore files', () => {
  const A = 'aaaaaaaaaaaa'
  it('keeps one directory per theme with its current files only', async () => {
    const dir = path.join(await tmp('files'), 'artifacts')
    const s = fsArtifactStore({ dir })
    await s.writeFiles(A, { put: { 'manifest.json': bytes('1'), 'assets/a.css': bytes('a') } })
    await s.writeFiles(A, { put: { 'manifest.json': bytes('2') }, delete: ['assets/a.css'] })
    expect(await readFile(path.join(dir, 'themes', A, 'manifest.json'), 'utf8')).toBe('2')
    expect(existsSync(path.join(dir, 'themes', A, 'assets', 'a.css'))).toBe(false)
    // No temp files left behind.
    expect((await readdir(path.join(dir, 'themes', A))).filter((f) => f.endsWith('.tmp'))).toEqual([])
    for (const bad of ['', '../x', 'ABCDEF012345', 'a'.repeat(13)]) await expect(s.writeFiles(bad, { put: { x: bytes('x') } }), bad).rejects.toThrow(/invalid theme id/)
  })

  it('replaces a file by rename: readers never see a partial file', async () => {
    const s = fsArtifactStore({ dir: path.join(await tmp('atomic'), 'artifacts') })
    const big = (c: string) => bytes(c.repeat(2_000_000))
    await s.writeFiles(A, { put: { 'assets/big.bin': big('a') } })
    let stop = false
    let reads = 0
    const reader = (async () => {
      while (!stop) {
        const b = new TextDecoder().decode((await s.readFile(A, 'assets/big.bin'))!)
        expect(b.length).toBe(2_000_000)
        expect(new Set(b).size).toBe(1)
        reads++
      }
    })()
    for (let i = 0; i < 10; i++) await s.writeFiles(A, { put: { 'assets/big.bin': big(i % 2 ? 'a' : 'b') } })
    stop = true
    await reader
    expect(reads).toBeGreaterThan(0)
  })

  it('copyFiles hard-links (no copy of the bytes) and a later write leaves the source alone', async () => {
    const dir = path.join(await tmp('copy'), 'artifacts')
    const s = fsArtifactStore({ dir })
    await s.writeFiles(A, { put: { 'assets/x.css': bytes('x') } })
    await s.copyFiles(A, 'bbbbbbbbbbbb')
    expect((await stat(path.join(dir, 'themes', 'bbbbbbbbbbbb', 'assets', 'x.css'))).ino).toBe((await stat(path.join(dir, 'themes', A, 'assets', 'x.css'))).ino)
    await s.writeFiles('bbbbbbbbbbbb', { put: { 'assets/x.css': bytes('y') } })
    expect(new TextDecoder().decode((await s.readFile(A, 'assets/x.css'))!)).toBe('x')
  })
})

describe('fsArtifactStore themes', () => {
  const theme = (id: string, hash: string | null, role: Theme['role'] = 'main'): Theme => ({ id, name: id, role, hash, createdAt: '', updatedAt: '' })

  it('keeps the list in themes.json; its version is the file hash', async () => {
    const dir = path.join(await tmp('themes'), 'artifacts')
    const s = fsArtifactStore({ dir })
    expect(await s.readThemes()).toEqual({ version: 'none', themes: [] })
    const a = 'f'.repeat(64)
    await s.writeThemes([theme('aaaaaaaaaaaa', a)], { expect: 'none' })
    const raw = await readFile(path.join(dir, 'themes.json'))
    expect(JSON.parse(raw.toString()).themes).toEqual([theme('aaaaaaaaaaaa', a)])
    expect((await s.readThemes()).version).toBe(createHash('sha256').update(raw).digest('hex'))
    await expect(s.writeThemes([theme('../escape', a)], { expect: (await s.readThemes()).version })).rejects.toThrow(/invalid theme id/)
  })

  it('compare-and-swap is serialized: of two writers holding the same version, one wins', async () => {
    const s = fsArtifactStore({ dir: path.join(await tmp('cas'), 'artifacts') })
    const a = 'f'.repeat(64)
    const { version } = await s.readThemes()
    const results = await Promise.allSettled([
      s.writeThemes([theme('aaaaaaaaaaaa', a)], { expect: version }),
      s.writeThemes([theme('bbbbbbbbbbbb', a)], { expect: version }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['THEME_CONFLICT'])
  })

  it('takes over a stale lock left by a crashed writer', async () => {
    const dir = path.join(await tmp('lock'), 'artifacts')
    const s = fsArtifactStore({ dir })
    const a = 'f'.repeat(64)
    const lock = path.join(dir, '.themes.lock')
    await mkdir(dir, { recursive: true })
    await writeFile(lock, '')
    const old = new Date(Date.now() - 11_000)
    await utimes(lock, old, old)
    await s.writeThemes([theme('aaaaaaaaaaaa', a)], { expect: 'none' })
    expect((await s.readThemes()).themes).toHaveLength(1)
    expect(existsSync(lock)).toBe(false)
  })

  it('watch reports theme list changes', async () => {
    const s = fsArtifactStore({ dir: path.join(await tmp('watch'), 'artifacts') })
    const a = 'f'.repeat(64)
    let changes = 0
    const stop = s.watch!(() => changes++)
    await s.writeThemes([theme('aaaaaaaaaaaa', a)], { expect: 'none' })
    await expect.poll(() => changes, { timeout: 3000 }).toBeGreaterThan(0)
    stop()
  })
})
