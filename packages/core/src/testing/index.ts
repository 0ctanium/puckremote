/**
 * Contract test suite for adapter authors. Run it against your implementation:
 *
 *   import { artifactStoreContract } from '@puck-remote/core/testing'
 *   artifactStoreContract('s3', async () => s3ArtifactStore({ bucket: await freshBucket() }))
 *
 * `make()` must return a fresh, empty store. Ids are opaque: the suite never assumes a format.
 */
import type { ArtifactStore } from '@puck-remote/sdk/host'
import { describe, expect, it } from 'vitest'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b))

export function artifactStoreContract(name: string, make: () => Promise<ArtifactStore> | ArtifactStore): void {
  describe(`ArtifactStore contract: ${name}`, () => {
    it('starts empty', async () => {
      const s = await make()
      expect(await s.readPointer()).toBeNull()
      expect(await s.list()).toEqual([])
    })

    it('writes artifacts, returns their ids, reads files, lists ids', async () => {
      const s = await make()
      const a = await s.writeArtifact({ 'manifest.json': bytes('{"v":1}'), 'pages/home.json': bytes('{}') })
      const b = await s.writeArtifact({ 'manifest.json': bytes('{"v":2}'), 'assets/a/b.css': bytes('b{}') })
      expect(typeof a).toBe('string')
      expect(a).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
      expect(a).not.toBe(b)
      expect((await s.list()).sort()).toEqual([a, b].sort())
      expect(text(await s.readFile(b, 'assets/a/b.css'))).toBe('b{}')
      expect(text(await s.readFile(a, 'pages/home.json'))).toBe('{}')
      expect(await s.readFile(a, 'assets/a/b.css')).toBeNull()
      expect(await s.readFile('missing', 'manifest.json').catch(() => null)).toBeNull()
    })

    it('artifacts are immutable: writing again never changes a stored artifact', async () => {
      const s = await make()
      const a = await s.writeArtifact({ 'manifest.json': bytes('a') })
      const b = await s.writeArtifact({ 'manifest.json': bytes('b') })
      expect(text(await s.readFile(a, 'manifest.json'))).toBe('a')
      expect(text(await s.readFile(b, 'manifest.json'))).toBe('b')
    })

    it('moves the pointer, and refuses a pointer to a missing artifact', async () => {
      const s = await make()
      const a = await s.writeArtifact({ 'manifest.json': bytes('a') })
      const b = await s.writeArtifact({ 'manifest.json': bytes('b') })
      await s.writePointer(b)
      expect(await s.readPointer()).toBe(b)
      await s.writePointer(a)
      expect(await s.readPointer()).toBe(a)
      await expect(s.writePointer('missing')).rejects.toThrow()
      expect(await s.readPointer()).toBe(a)
    })

    it('never resolves unsafe paths', async () => {
      const s = await make()
      const a = await s.writeArtifact({ 'manifest.json': bytes('a') })
      for (const p of ['../current.json', '/etc/passwd', 'a/../manifest.json', './manifest.json', '', 'a\\b', 'x\0y']) {
        expect(await s.readFile(a, p).catch(() => null), JSON.stringify(p)).toBeNull()
      }
      await expect(s.writeArtifact({ '../escape': bytes('x') })).rejects.toThrow()
    })
  })
}
