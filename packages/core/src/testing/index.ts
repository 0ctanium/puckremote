/**
 * Contract test suite for adapter authors. Run it against your implementation:
 *
 *   import { artifactStoreContract } from '@puck-remote/core/testing'
 *   artifactStoreContract('s3', async () => s3ArtifactStore({ bucket: await freshBucket() }))
 *
 * `make()` must return a fresh, empty store.
 */
import type { ArtifactStore, Theme } from '@puck-remote/sdk/host'
import { describe, expect, it } from 'vitest'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b))

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'

export function artifactStoreContract(name: string, make: () => Promise<ArtifactStore> | ArtifactStore): void {
  describe(`ArtifactStore contract: ${name}`, () => {
    it('starts empty', async () => {
      const s = await make()
      expect((await s.readThemes()).themes).toEqual([])
      expect(await s.readFile(A, 'manifest.json')).toBeNull()
    })

    it('writes, replaces and removes a theme’s files; themes are independent', async () => {
      const s = await make()
      await s.writeFiles(A, { put: { 'manifest.json': bytes('{"v":1}'), 'assets/a/b.css': bytes('b{}'), 'templates/home.json': bytes('{}') } })
      await s.writeFiles(B, { put: { 'manifest.json': bytes('{"v":2}') } })
      expect(text(await s.readFile(A, 'assets/a/b.css'))).toBe('b{}')
      expect(text(await s.readFile(B, 'manifest.json'))).toBe('{"v":2}')
      expect(await s.readFile(B, 'assets/a/b.css')).toBeNull()
      await s.writeFiles(A, { put: { 'manifest.json': bytes('{"v":3}') }, delete: ['templates/home.json'] })
      expect(text(await s.readFile(A, 'manifest.json'))).toBe('{"v":3}')
      expect(await s.readFile(A, 'templates/home.json')).toBeNull()
      expect(text(await s.readFile(A, 'assets/a/b.css'))).toBe('b{}')
    })

    it('copies a theme’s files; changing the copy leaves the source alone', async () => {
      const s = await make()
      await s.writeFiles(A, { put: { 'manifest.json': bytes('a'), 'assets/x.css': bytes('x') } })
      await s.copyFiles(A, B)
      expect(text(await s.readFile(B, 'assets/x.css'))).toBe('x')
      await s.writeFiles(B, { put: { 'assets/x.css': bytes('changed') } })
      expect(text(await s.readFile(A, 'assets/x.css'))).toBe('x')
    })

    it('deletes a theme’s files', async () => {
      const s = await make()
      await s.writeFiles(A, { put: { 'manifest.json': bytes('a') } })
      await s.deleteFiles(A)
      await s.deleteFiles(A)
      expect(await s.readFile(A, 'manifest.json')).toBeNull()
    })

    it('replaces the theme list atomically and refuses a stale version', async () => {
      const s = await make()
      const theme = (id: string, hash: string | null, role: Theme['role']): Theme => ({
        id, name: id, role, hash, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      })
      const v0 = (await s.readThemes()).version
      await s.writeThemes([theme(A, 'f'.repeat(64), 'main')], { expect: v0 })
      const first = await s.readThemes()
      expect(first.themes).toEqual([theme(A, 'f'.repeat(64), 'main')])
      expect(first.version).not.toBe(v0)
      // A writer holding the old version loses.
      await expect(s.writeThemes([], { expect: v0 })).rejects.toMatchObject({ code: 'THEME_CONFLICT' })
      const next = [theme(A, 'f'.repeat(64), 'unpublished'), theme(B, null, 'main')]
      await s.writeThemes(next, { expect: first.version })
      expect((await s.readThemes()).themes).toEqual(next)
    })

    it('never resolves unsafe paths', async () => {
      const s = await make()
      await s.writeFiles(A, { put: { 'manifest.json': bytes('a') } })
      for (const p of ['../themes.json', '/etc/passwd', 'a/../manifest.json', './manifest.json', '', 'a\\b', 'x\0y']) {
        expect(await s.readFile(A, p).catch(() => null), JSON.stringify(p)).toBeNull()
      }
      await expect(s.writeFiles(A, { put: { '../escape': bytes('x') } })).rejects.toThrow()
    })
  })
}
