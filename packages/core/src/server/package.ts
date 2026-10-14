/**
 * Theme packages: an artifact's files as a gzip-compressed tar (`puck-remote package`, uploaded
 * by `puck-remote publish`), with the files of dist/ at the archive root. Unpacked in memory with
 * hard limits, before any validation of the content.
 */
import { gunzipSync } from 'node:zlib'
import { Parser } from 'tar'

export interface PackageLimits {
  maxPackageBytes: number
  maxUnpackedBytes: number
  maxFiles: number
}

export class PackageError extends Error {
  constructor(
    message: string,
    /** HTTP status the artifacts API answers with. */
    readonly status: 400 | 413,
  ) {
    super(message)
  }
}

/** Files of a package, by POSIX path. Only regular files are accepted (no links, devices…). */
export async function unpackPackage(bytes: Uint8Array, limits: PackageLimits): Promise<Record<string, Uint8Array>> {
  if (bytes.byteLength > limits.maxPackageBytes) throw new PackageError(`package larger than ${limits.maxPackageBytes} bytes`, 413)
  let tarBytes: Buffer
  try {
    // Headers take 512 bytes per entry (plus PAX records): leave room for them, the file sizes are checked below.
    tarBytes = gunzipSync(bytes, { maxOutputLength: limits.maxUnpackedBytes + (limits.maxFiles + 2) * 2048 })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new PackageError(`package unpacks to more than ${limits.maxUnpackedBytes} bytes`, 413)
    throw new PackageError('package is not a gzip-compressed tar', 400)
  }

  const files: Record<string, Uint8Array> = Object.create(null)
  let total = 0
  let error: PackageError | null = null
  const fail = (e: PackageError) => {
    error ??= e
  }
  const parser = new Parser({ strict: true })
  parser.on('warn', (_code: string, message: string) => fail(new PackageError(`invalid package: ${message}`, 400)))
  parser.on('error', (e: Error) => fail(new PackageError(`invalid package: ${e.message}`, 400)))
  parser.on('entry', (entry) => {
    const path = entry.path.replace(/^(\.\/)+/, '')
    if (entry.type === 'Directory' || error) return entry.resume()
    if (entry.type !== 'File' && entry.type !== 'OldFile') {
      fail(new PackageError(`package entry ${path} is not a regular file`, 400))
      return entry.resume()
    }
    if (path in files) fail(new PackageError(`package lists ${path} twice`, 400))
    if (Object.keys(files).length >= limits.maxFiles) fail(new PackageError(`package has more than ${limits.maxFiles} files`, 413))
    total += entry.size
    if (total > limits.maxUnpackedBytes) fail(new PackageError(`package unpacks to more than ${limits.maxUnpackedBytes} bytes`, 413))
    if (error) return entry.resume()
    const chunks: Buffer[] = []
    entry.on('data', (c: Buffer) => chunks.push(c))
    entry.on('end', () => {
      files[path] = new Uint8Array(Buffer.concat(chunks))
    })
  })
  await new Promise<void>((resolve) => {
    parser.on('close', () => resolve())
    parser.end(tarBytes)
  })
  if (error) throw error
  return { ...files }
}
