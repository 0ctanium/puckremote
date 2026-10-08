/** Built-in adapters pass the same contract suite third-party adapters are given. */
import { artifactHash, fsArtifactStore } from '@puck-remote/artifacts-fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactStoreContract } from '../src/testing/index.ts'
import { counterStore } from './helpers.ts'

const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), `puck-remote-${p}-`))
const bytes = (s: string) => new TextEncoder().encode(s)

artifactStoreContract('fs', async () => fsArtifactStore({ dir: path.join(await tmp('art'), 'artifacts') }))
artifactStoreContract('counter (test store)', () => counterStore())

describe('fsArtifactStore specifics', () => {
  it('ids are content hashes: independent of file order, identical content is stored once', async () => {
    const s = fsArtifactStore({ dir: path.join(await tmp('art'), 'artifacts') })
    const a = await s.writeArtifact({ 'manifest.json': bytes('m'), 'pages/home.json': bytes('{}') })
    const b = await s.writeArtifact({ 'pages/home.json': bytes('{}'), 'manifest.json': bytes('m') })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(artifactHash({ 'manifest.json': bytes('m'), 'pages/home.json': bytes('{}') }))
    expect(await s.list()).toEqual([a])
    // A path is part of the hash, not just the bytes.
    expect(await s.writeArtifact({ 'manifest.json': bytes('m'), 'pages/about.json': bytes('{}') })).not.toBe(a)
  })
})
