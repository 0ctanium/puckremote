/**
 * Contract test suites for adapter authors. Run them against your implementation:
 *
 *   import { artifactStoreContract } from '@puck-remote/core/testing'
 *   artifactStoreContract('s3', async () => s3ArtifactStore({ bucket: await freshBucket() }))
 *
 * Each `make()` must return a fresh, empty store.
 */
import type { ArtifactStore, CacheStore, PageStore } from '@puck-remote/sdk/host'
import { describe, expect, it } from 'vitest'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b))

export function pageStoreContract(name: string, make: () => Promise<PageStore> | PageStore): void {
  describe(`PageStore contract: ${name}`, () => {
    it('returns null for a missing page', async () => {
      expect(await (await make()).get('nope')).toBeNull()
    })
    it('round-trips JSON, overwrites, and lists slugs (nested included)', async () => {
      const s = await make()
      const page = { root: { props: { title: 'Ünïcode ✓' } }, content: [{ type: 'card', props: { id: 'c', n: 1, nested: { a: [1, null, true] } } }] }
      await s.put('home', page)
      await s.put('blog/post-1', { root: { props: {} }, content: [] })
      expect(await s.get('home')).toEqual(page)
      await s.put('home', { root: { props: { title: 'v2' } }, content: [] })
      expect(((await s.get('home')) as { root: { props: { title: string } } }).root.props.title).toBe('v2')
      expect((await s.list()).sort()).toEqual(['blog/post-1', 'home'])
    })
  })
}

export function artifactStoreContract(name: string, make: () => Promise<ArtifactStore> | ArtifactStore): void {
  describe(`ArtifactStore contract: ${name}`, () => {
    it('starts empty', async () => {
      const s = await make()
      expect(await s.readPointer()).toBeNull()
      expect(await s.listVersions()).toEqual([])
      expect(await s.readFile(1, 'manifest.json')).toBeNull()
    })

    it('writes versions, reads files, lists versions in order', async () => {
      const s = await make()
      await s.writeVersion(2, { 'manifest.json': bytes('{"v":2}'), 'assets/a/b.css': bytes('b{}') })
      await s.writeVersion(1, { 'manifest.json': bytes('{"v":1}') })
      expect(await s.listVersions()).toEqual([1, 2])
      expect(text(await s.readFile(2, 'assets/a/b.css'))).toBe('b{}')
      expect(text(await s.readFile(1, 'manifest.json'))).toBe('{"v":1}')
      expect(await s.readFile(1, 'assets/a/b.css')).toBeNull()
    })

    it('versions are immutable', async () => {
      const s = await make()
      await s.writeVersion(1, { 'manifest.json': bytes('a') })
      await expect(s.writeVersion(1, { 'manifest.json': bytes('b') })).rejects.toThrow()
      expect(text(await s.readFile(1, 'manifest.json'))).toBe('a')
    })

    it('moves the pointer, and refuses a pointer to a missing version', async () => {
      const s = await make()
      await s.writeVersion(1, { 'manifest.json': bytes('a') })
      await s.writeVersion(2, { 'manifest.json': bytes('b') })
      await s.writePointer(2)
      expect(await s.readPointer()).toBe(2)
      await s.writePointer(1)
      expect(await s.readPointer()).toBe(1)
      await expect(s.writePointer(9)).rejects.toThrow()
      expect(await s.readPointer()).toBe(1)
    })

    it('never resolves unsafe paths', async () => {
      const s = await make()
      await s.writeVersion(1, { 'manifest.json': bytes('a') })
      for (const p of ['../current.json', '/etc/passwd', 'a/../manifest.json', './manifest.json', '', 'a\\b', 'x\0y']) {
        expect(await s.readFile(1, p).catch(() => null), JSON.stringify(p)).toBeNull()
      }
      await expect(s.writeVersion(2, { '../escape': bytes('x') })).rejects.toThrow()
    })
  })
}

export function cacheStoreContract(name: string, make: () => Promise<CacheStore> | CacheStore): void {
  describe(`CacheStore contract: ${name}`, () => {
    it('misses with undefined and stores JSON values (null included)', async () => {
      const c = await make()
      expect(await c.get('k')).toBeUndefined()
      await c.set('k', { a: [1, 'x'] }, {})
      await c.set('n', null, {})
      expect(await c.get('k')).toEqual({ a: [1, 'x'] })
      expect(await c.get('n')).toBeNull()
    })
    it('expires entries after ttlMs', async () => {
      const c = await make()
      await c.set('t', 1, { ttlMs: 30 })
      expect(await c.get('t')).toBe(1)
      await new Promise((r) => setTimeout(r, 60))
      expect(await c.get('t')).toBeUndefined()
    })
    it('invalidates by tag, only matching entries', async () => {
      const c = await make()
      await c.set('a', 1, { tags: ['posts'] })
      await c.set('b', 2, { tags: ['posts', 'authors'] })
      await c.set('c', 3, { tags: ['authors'] })
      await c.invalidateTags(['posts'])
      expect(await c.get('a')).toBeUndefined()
      expect(await c.get('b')).toBeUndefined()
      expect(await c.get('c')).toBe(3)
    })
  })
}
