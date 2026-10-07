/**
 * Host wiring: the ONLY place that knows which backend serves theme data and where pages live.
 * The host core depends on Puck and the @poc/sdk/host contracts; swap these for Payload, a SQL
 * database, a headless CMS, S3… without touching the core.
 */
import path from 'node:path'
import { fsPageStore } from '@poc/pages-fs'
import { mockCms } from '@poc/source-mock'

export function plugins({ rootDir }: { rootDir: string }) {
  return {
    source: mockCms({ dataFile: path.join(rootDir, 'data', 'cms.json') }),
    pages: fsPageStore({ dir: path.join(rootDir, 'data', 'pages') }),
  }
}
