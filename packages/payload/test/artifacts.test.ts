/** payloadArtifactStore on a real Payload (SQLite): the shared contract, concurrent list writes, pruning. */
import { artifactStoreContract } from '@puck-remote/core/testing'
import { ThemeConflictError, type Theme } from '@puck-remote/sdk/host'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadArtifactStore } from '../src/artifacts.ts'
import { artifactCollections, THEME_FILES, THEME_LISTS } from '../src/collections.ts'
import { payloadFixture, type Fixture } from './fixture.ts'

let f: Fixture
beforeAll(async () => {
  f = await payloadFixture({ collections: artifactCollections() })
}, 60_000)
afterAll(() => f?.close())

/** A fresh, empty store: both collections cleared. */
async function fresh() {
  for (const collection of [THEME_LISTS, THEME_FILES]) await f.payload.delete({ collection: collection as never, where: { id: { exists: true } }, overrideAccess: true })
  return payloadArtifactStore({ payload: () => f.payload })
}

artifactStoreContract('payload (sqlite)', fresh)

const theme = (id: string): Theme => ({ id, name: id, role: 'main', hash: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })

describe('payloadArtifactStore', () => {
  it('versions the list by seq; of two concurrent writers on one version, one gets ThemeConflictError', async () => {
    const s = await fresh()
    expect((await s.readThemes()).version).toBe('0')
    const results = await Promise.allSettled([s.writeThemes([theme('aaaaaaaaaaaa')], { expect: '0' }), s.writeThemes([theme('bbbbbbbbbbbb')], { expect: '0' })])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(ThemeConflictError)
    expect((await s.readThemes()).version).toBe('1')
  })

  it('keeps the last 20 revisions', async () => {
    const s = await fresh()
    for (let i = 0; i < 25; i++) await s.writeThemes([theme('aaaaaaaaaaaa')], { expect: String(i) })
    const { totalDocs } = await f.payload.count({ collection: THEME_LISTS as never, overrideAccess: true })
    expect(totalDocs).toBe(20)
    expect((await s.readThemes()).version).toBe('25')
  })

  it('round-trips binary files and is not reachable through Payload access control', async () => {
    const s = await fresh()
    const bin = new Uint8Array([0, 255, 1, 128, 10])
    await s.writeFiles('aaaaaaaaaaaa', { put: { 'assets/x.bin': bin } })
    expect(await s.readFile('aaaaaaaaaaaa', 'assets/x.bin')).toEqual(bin)
    // Larger than Payload's default text limit (40 000 characters) once base64-encoded.
    const big = new Uint8Array(300_000).fill(7)
    await s.writeFiles('aaaaaaaaaaaa', { put: { 'bundle.js': big } })
    expect(await s.readFile('aaaaaaaaaaaa', 'bundle.js')).toEqual(big)
    await expect(f.payload.find({ collection: THEME_FILES as never, overrideAccess: false })).rejects.toThrow()
  })
})
