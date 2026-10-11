/**
 * Partial pushes: compare the built dist/ with the theme's current manifest and upload only the
 * files that are new or changed, plus manifest.json (files the new manifest no longer lists are
 * removed by the host). A block change sends the bundles, an asset change that asset, a template
 * change that template.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ApiClient, ThemeResult } from './api-client.ts'
import { packDist } from './package.ts'

const manifestFiles = (bytes: Uint8Array): Record<string, string> => {
  const files = JSON.parse(new TextDecoder().decode(bytes))?.files
  return files && typeof files === 'object' ? files : {}
}

/** Which files of `local` (a manifest's files) differ from `remote` (null: the theme has no files). */
export function diffManifests(local: Record<string, string>, remote: Record<string, string> | null): { upload: string[]; removed: string[] } {
  const upload = Object.keys(local).filter((rel) => remote?.[rel] !== local[rel])
  const removed = remote ? Object.keys(remote).filter((rel) => !Object.hasOwn(local, rel)) : []
  return { upload: [...upload.sort(), 'manifest.json'], removed: removed.sort() }
}

export interface PushedFiles extends ThemeResult {
  /** Files uploaded (manifest.json included). */
  sent: string[]
  /** Files the theme no longer has. */
  removed: string[]
}

/** Upload what changed between dist/ and the theme's current files. */
export async function pushDist(client: ApiClient, theme: string, distDir: string, opts: { expect?: string } = {}): Promise<PushedFiles> {
  const local = manifestFiles(new Uint8Array(await readFile(path.join(distDir, 'manifest.json'))))
  const remoteBytes = await client.readFile(theme, 'manifest.json')
  const { upload, removed } = diffManifests(local, remoteBytes ? manifestFiles(remoteBytes) : null)
  const result = await client.pushFiles(theme, await packDist(distDir, upload), opts)
  return { ...result, sent: upload, removed }
}
