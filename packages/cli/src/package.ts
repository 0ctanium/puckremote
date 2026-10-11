/**
 * `puck-remote package`: the built artifact (dist/) as one gzip-compressed tar, files at the
 * archive root. It is what `publish` uploads; `publish --file` uploads an existing one.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { create } from 'tar'

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(p, base)))
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

/** The package bytes of a built dist/ directory (or only of `only`, relative paths in it). */
export async function packDist(distDir: string, only?: string[]): Promise<Uint8Array> {
  if (!existsSync(path.join(distDir, 'manifest.json'))) throw new Error(`no manifest.json in ${distDir}; run "puck-remote build" first`)
  const files = (only ?? (await listFiles(distDir))).slice().sort()
  const chunks: Buffer[] = []
  // portable: no uid/gid/user names from this machine in the archive.
  const stream = create({ gzip: true, cwd: distDir, portable: true }, files)
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(c)
  return new Uint8Array(Buffer.concat(chunks))
}

export interface PackageOptions {
  /** The built theme (dist/). */
  distDir: string
  /** Theme repo (for the default file name). */
  cwd: string
  /** Output file. Default <cwd>/<package name>-<bundle hash, 12 chars>.tar.gz */
  file?: string
  quiet?: boolean
}

/** Write the package of dist/ to a file. */
export async function writePackage(opts: PackageOptions): Promise<{ file: string; bytes: Uint8Array }> {
  const bytes = await packDist(opts.distDir)
  let file = opts.file
  if (!file) {
    const manifest = JSON.parse(await readFile(path.join(opts.distDir, 'manifest.json'), 'utf8'))
    const pkg = existsSync(path.join(opts.cwd, 'package.json')) ? JSON.parse(await readFile(path.join(opts.cwd, 'package.json'), 'utf8')) : {}
    const name = String(pkg.name ?? 'theme').replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
    file = path.join(opts.cwd, `${name}-${String(manifest.files?.['bundle.js'] ?? '').slice(0, 12)}.tar.gz`)
  }
  await writeFile(file, bytes)
  if (!opts.quiet) console.log(`[puck-remote package] ${file} (${bytes.byteLength} bytes)`)
  return { file, bytes }
}
