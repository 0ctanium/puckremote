/** Built-in adapters pass the same contract suites third-party adapters are given. */
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { fsPageStore } from '@puck-remote/pages-fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { memoryCache } from '../src/server/query/cache.ts'
import { artifactStoreContract, cacheStoreContract, pageStoreContract } from '../src/testing/index.ts'

const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), `puck-remote-${p}-`))

pageStoreContract('fs', async () => fsPageStore({ dir: await tmp('pages') }))
artifactStoreContract('fs', async () => fsArtifactStore({ dir: path.join(await tmp('art'), 'artifacts') }))
cacheStoreContract('memory', () => memoryCache())

describe('fsPageStore specifics', () => {
  it('prunes old revisions beyond maxRevisions but keeps the draft and the published one', async () => {
    const s = fsPageStore({ dir: await tmp('pages'), maxRevisions: 3 })
    const data = (n: number) => ({ root: { props: { n } }, content: [] })
    let base: string | null = null
    const revs: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = await s.saveDraft('home', { data: data(i), schemaVersion: 1 }, { baseRevision: base })
      if (!r.ok) throw new Error()
      base = r.meta.draftRevision
      revs.push(base)
      if (i === 0) await s.publish('home', { revision: base }) // revision 1 stays published
    }
    const kept = (await s.history('home', { limit: 100 })).map((r) => r.revision)
    expect(kept).toHaveLength(3)
    expect(kept).toContain(revs[5]) // draft
    expect(kept).toContain(revs[0]) // published
    expect(revs[0]).toBe('00000001')
    expect(await s.getRevision('home', '../meta')).toBeNull() // revision ids are validated
  })
})
