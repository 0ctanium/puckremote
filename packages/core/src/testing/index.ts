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

const pageData = (title: string) => ({ root: { props: { title } }, content: [] as unknown[] })
const titleOf = (rev: { data: unknown } | null) => (rev?.data as { root: { props: { title: string } } } | undefined)?.root.props.title

export function pageStoreContract(name: string, make: () => Promise<PageStore> | PageStore): void {
  describe(`PageStore contract: ${name}`, () => {
    it('returns null / empty for a missing page', async () => {
      const s = await make()
      expect(await s.meta('nope')).toBeNull()
      expect(await s.getDraft('nope')).toBeNull()
      expect(await s.getPublished('nope')).toBeNull()
      expect(await s.getRevision('nope', 'x')).toBeNull()
      expect(await s.history('nope', { limit: 10 })).toEqual([])
      expect(await s.list()).toEqual([])
    })

    it('creates once (baseRevision null), then requires the current draft as base', async () => {
      const s = await make()
      const page = { root: { props: { title: 'Ünïcode ✓' } }, content: [{ type: 'card', props: { id: 'c', nested: { a: [1, null, true] } } }] }
      const a = await s.saveDraft('home', { data: page, schemaVersion: 1 }, { baseRevision: null, author: 'alice' })
      if (!a.ok) throw new Error('create failed')
      expect(a.meta).toMatchObject({ slug: 'home', publishedRevision: null, publishedAt: null })
      const draft = await s.getDraft('home')
      expect(draft).toMatchObject({ revision: a.meta.draftRevision, schemaVersion: 1, data: page, author: 'alice' })
      expect(typeof draft!.createdAt).toBe('string')

      const again = await s.saveDraft('home', { data: pageData('x'), schemaVersion: 1 }, { baseRevision: null })
      expect(again).toMatchObject({ ok: false, reason: 'conflict', meta: { draftRevision: a.meta.draftRevision } })

      const b = await s.saveDraft('home', { data: pageData('v2'), schemaVersion: 1 }, { baseRevision: a.meta.draftRevision })
      if (!b.ok) throw new Error('save failed')
      expect(b.meta.draftRevision).not.toBe(a.meta.draftRevision)

      const stale = await s.saveDraft('home', { data: pageData('lost'), schemaVersion: 1 }, { baseRevision: a.meta.draftRevision })
      expect(stale).toMatchObject({ ok: false, reason: 'conflict', meta: { draftRevision: b.meta.draftRevision } })
      expect(titleOf(await s.getDraft('home'))).toBe('v2')
    })

    it('publishes only the current draft; later drafts leave the published revision alone', async () => {
      const s = await make()
      const a = await s.saveDraft('home', { data: pageData('one'), schemaVersion: 1 }, { baseRevision: null })
      if (!a.ok) throw new Error()
      const b = await s.saveDraft('home', { data: pageData('two'), schemaVersion: 1 }, { baseRevision: a.meta.draftRevision })
      if (!b.ok) throw new Error()
      expect((await s.publish('home', { revision: a.meta.draftRevision })).ok).toBe(false)
      expect(await s.getPublished('home')).toBeNull()

      const p = await s.publish('home', { revision: b.meta.draftRevision })
      if (!p.ok) throw new Error()
      expect(p.meta.publishedRevision).toBe(b.meta.draftRevision)
      expect(typeof p.meta.publishedAt).toBe('string')

      const c = await s.saveDraft('home', { data: pageData('three'), schemaVersion: 1 }, { baseRevision: b.meta.draftRevision })
      if (!c.ok) throw new Error()
      expect(c.meta.publishedRevision).toBe(b.meta.draftRevision)
      expect(titleOf(await s.getPublished('home'))).toBe('two')
      expect(titleOf(await s.getDraft('home'))).toBe('three')
      expect(titleOf(await s.getRevision('home', a.meta.draftRevision))).toBe('one')
      expect((await s.publish('nope', { revision: c.meta.draftRevision })).ok).toBe(false)
    })

    it('unpublishes and deletes', async () => {
      const s = await make()
      const a = await s.saveDraft('blog/post-1', { data: pageData('p'), schemaVersion: 1 }, { baseRevision: null })
      if (!a.ok) throw new Error()
      await s.publish('blog/post-1', { revision: a.meta.draftRevision })
      await s.unpublish('blog/post-1')
      expect(await s.getPublished('blog/post-1')).toBeNull()
      expect(await s.meta('blog/post-1')).toMatchObject({ publishedRevision: null, publishedAt: null })
      expect(titleOf(await s.getDraft('blog/post-1'))).toBe('p')
      await s.unpublish('blog/post-1')
      await s.delete('blog/post-1')
      expect(await s.meta('blog/post-1')).toBeNull()
      expect(await s.history('blog/post-1', { limit: 10 })).toEqual([])
      await s.delete('blog/post-1')
    })

    it('lists pages (nested slugs included)', async () => {
      const s = await make()
      await s.saveDraft('home', { data: pageData('h'), schemaVersion: 1 }, { baseRevision: null })
      await s.saveDraft('blog/post-1', { data: pageData('p'), schemaVersion: 1 }, { baseRevision: null })
      expect((await s.list()).map((m) => m.slug).sort()).toEqual(['blog/post-1', 'home'])
    })

    it('history is newest first, without data, paged with limit/before', async () => {
      const s = await make()
      let base: string | null = null
      const revs: string[] = []
      for (let i = 0; i < 5; i++) {
        const r = await s.saveDraft('home', { data: pageData(`v${i}`), schemaVersion: 1 }, { baseRevision: base })
        if (!r.ok) throw new Error()
        base = r.meta.draftRevision
        revs.push(base)
      }
      const first = await s.history('home', { limit: 2 })
      expect(first.map((r) => r.revision)).toEqual([revs[4], revs[3]])
      expect(first[0]).not.toHaveProperty('data')
      const next = await s.history('home', { limit: 10, before: first[1].revision })
      expect(next.map((r) => r.revision)).toEqual([revs[2], revs[1], revs[0]])
    })

    it('concurrent saves on the same base: exactly one wins', async () => {
      const s = await make()
      const a = await s.saveDraft('home', { data: pageData('a'), schemaVersion: 1 }, { baseRevision: null })
      if (!a.ok) throw new Error()
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => s.saveDraft('home', { data: pageData(`c${i}`), schemaVersion: 1 }, { baseRevision: a.meta.draftRevision })),
      )
      expect(results.filter((r) => r.ok)).toHaveLength(1)
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
