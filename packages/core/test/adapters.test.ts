/** Built-in adapters pass the same contract suites third-party adapters are given. */
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { fsPageStore } from '@puck-remote/pages-fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { memoryCache } from '../src/server/query/cache.ts'
import { artifactStoreContract, cacheStoreContract, pageStoreContract } from '../src/testing/index.ts'

const tmp = (p: string) => mkdtemp(path.join(os.tmpdir(), `puck-remote-${p}-`))

pageStoreContract('fs', async () => fsPageStore({ dir: await tmp('pages') }))
artifactStoreContract('fs', async () => fsArtifactStore({ dir: path.join(await tmp('art'), 'artifacts') }))
cacheStoreContract('memory', () => memoryCache())
