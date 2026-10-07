import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface PublishOptions {
  distDir: string
  artifactsDir: string
  quiet?: boolean
}

async function highestVersion(artifactsDir: string): Promise<number> {
  if (!existsSync(artifactsDir)) return 0
  const versions = (await readdir(artifactsDir))
    .map((d) => /^v(\d+)$/.exec(d)?.[1])
    .filter((v): v is string => !!v)
    .map(Number)
  return versions.length ? Math.max(...versions) : 0
}

/** Atomically point current.json at `version` (write temp file, then rename). Rollback uses this too. */
export async function activate(artifactsDir: string, version: number): Promise<void> {
  if (!existsSync(path.join(artifactsDir, `v${version}`, 'manifest.json'))) {
    throw new Error(`artifact v${version} does not exist in ${artifactsDir}`)
  }
  const tmp = path.join(artifactsDir, `.current.json.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tmp, JSON.stringify({ version }) + '\n')
  await rename(tmp, path.join(artifactsDir, 'current.json'))
}

export async function publish(opts: PublishOptions): Promise<{ version: number }> {
  if (!existsSync(path.join(opts.distDir, 'manifest.json'))) throw new Error(`no manifest.json in ${opts.distDir}; run "puck-remote build" first`)
  await mkdir(opts.artifactsDir, { recursive: true })
  const version = (await highestVersion(opts.artifactsDir)) + 1
  const target = path.join(opts.artifactsDir, `v${version}`)
  // Copy into a temp dir and rename so a half-copied version is never visible.
  const tmp = path.join(opts.artifactsDir, `.v${version}.${process.pid}.tmp`)
  await rm(tmp, { recursive: true, force: true })
  await cp(opts.distDir, tmp, { recursive: true })
  await rename(tmp, target)
  await activate(opts.artifactsDir, version)
  if (!opts.quiet) console.log(`[puck-remote publish] published v${version} → ${target}`)
  return { version }
}
