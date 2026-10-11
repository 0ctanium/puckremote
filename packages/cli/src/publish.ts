/**
 * Theme commands over the host's artifacts API, after `shopify theme`: push, publish, pull, list,
 * rename, delete, duplicate, share.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Theme, ThemeRole } from '@puck-remote/sdk/host'
import { createClient, type ApiClient, type ApiTarget, type ThemeResult } from './api-client.ts'
import { pushDist, type PushedFiles } from './diff.ts'
import { generateThemeName, resolveTheme, THEME_NAME_LIMIT } from './themes.ts'

/** What to upload: a build output (only what changed is sent) or a package file (sent whole). */
export interface ArtifactSource {
  /** A build output (dist/): only files that differ from the theme's current ones are sent… */
  distDir?: string
  /** …or a package (`puck-remote package`), uploaded whole. */
  file?: string
}

const fit = (name: string) => name.slice(0, THEME_NAME_LIMIT).trim()

/** Upload into a theme: a diff of dist/, or a whole package file. */
async function upload(client: ApiClient, theme: string, src: ArtifactSource, opts: { expect?: string } = {}): Promise<PushedFiles> {
  if (src.file) {
    if (!existsSync(src.file)) throw new Error(`no package at ${src.file}`)
    const r = await client.pushFiles(theme, new Uint8Array(await readFile(src.file)), opts)
    return { ...r, sent: ['(package)'], removed: [] }
  }
  if (src.distDir) return pushDist(client, theme, src.distDir, opts)
  throw new Error('push needs a build or a package file')
}

export interface PushOptions extends ArtifactSource {
  api: ApiTarget
  /** An existing theme (id or name). */
  theme?: string
  /** The main theme (created if the site has none). */
  live?: boolean
  /** A new unpublished theme. */
  unpublished?: boolean
  /** Name of a theme this push creates. */
  name?: string
  /** Default theme names (the theme's package.json name). */
  packageName?: string
  quiet?: boolean
}

/**
 * Upload the theme (code and templates, as they are in the repo) into a theme: only the files that
 * changed. Templates edited in the editor on that theme since the last `pull` are replaced, as in
 * Shopify.
 */
export async function push(opts: PushOptions): Promise<PushedFiles> {
  const targets = [opts.theme !== undefined, !!opts.live, !!opts.unpublished].filter(Boolean).length
  if (targets > 1) throw new Error('use only one of --theme, --live and --unpublished')
  const client = createClient(opts.api)
  const { themes, multiple } = await client.listThemes()
  if (!targets && multiple) throw new Error('this site has several themes: choose one with --theme <id|name>, --live or --unpublished')
  const baseName = opts.packageName ?? 'Theme'
  let target: Theme
  if (opts.unpublished) {
    target = (await client.createTheme({ name: fit(opts.name ?? `${baseName} (${randomBytes(3).toString('hex')})`), role: 'unpublished' })).theme
  } else if (opts.theme !== undefined) {
    target = resolveTheme(themes, opts.theme)
  } else {
    // --live, or no flag on a single-theme site: the main theme (created on the first push).
    target = themes.find((t) => t.role === 'main') ?? (await client.createTheme({ name: fit(opts.name ?? baseName), role: 'main' })).theme
  }
  const r = await upload(client, target.id, opts)
  if (!opts.quiet) log('push', r)
  return r
}

/** `name #id (role) → N files (a, b)`. */
export function describePush(r: PushedFiles): string {
  const shown = r.sent.filter((f) => f !== 'manifest.json')
  const files = shown.length ? `${shown.length} file${shown.length > 1 ? 's' : ''} (${shown.slice(0, 5).join(', ')}${shown.length > 5 ? ', …' : ''})` : 'no file changed'
  const removed = r.removed.length ? `, ${r.removed.length} removed` : ''
  return `${r.theme.name} #${r.theme.id} (${r.theme.role}) → ${files}${removed}`
}

function log(cmd: string, r: ThemeResult & Partial<PushedFiles>) {
  console.log(`[puck-remote ${cmd}] ${r.sent ? describePush(r as PushedFiles) : `${r.theme.name} #${r.theme.id} (${r.theme.role})`}`)
  if (r.previewUrl) console.log(`  preview: ${r.previewUrl}`)
}

async function find(client: ApiClient, ref: string): Promise<Theme> {
  return resolveTheme((await client.listThemes()).themes, ref)
}

/** Make a theme the main (live) one; the previous main theme becomes unpublished. */
export async function publish(api: ApiTarget, ref: string, opts: { quiet?: boolean } = {}): Promise<ThemeResult> {
  const client = createClient(api)
  const r = await client.publishTheme((await find(client, ref)).id)
  if (!opts.quiet) log('publish', r)
  return r
}

export async function listThemes(api: ApiTarget, opts: { role?: ThemeRole } = {}): Promise<Theme[]> {
  const { themes } = await createClient(api).listThemes()
  return opts.role ? themes.filter((t) => t.role === opts.role) : themes
}

export async function renameTheme(api: ApiTarget, ref: string, name: string): Promise<ThemeResult> {
  const client = createClient(api)
  return client.renameTheme((await find(client, ref)).id, name)
}

export async function deleteTheme(api: ApiTarget, ref: string): Promise<Theme> {
  const client = createClient(api)
  const theme = await find(client, ref)
  await client.deleteTheme(theme.id)
  return theme
}

export async function duplicateTheme(api: ApiTarget, ref: string, opts: { name?: string } = {}): Promise<ThemeResult> {
  const client = createClient(api)
  return client.duplicateTheme((await find(client, ref)).id, opts)
}

/** Push to a new unpublished theme named `Share (<6 hex>-<host name>)` and return its preview link. */
export async function share(opts: ArtifactSource & { api: ApiTarget; quiet?: boolean }): Promise<PushedFiles> {
  const client = createClient(opts.api)
  const { theme } = await client.createTheme({ name: generateThemeName('Share'), role: 'unpublished' })
  const r = await upload(client, theme.id, opts)
  if (!opts.quiet) log('share', r)
  return r
}

export interface PullOptions {
  /** The theme repo: templates are written to <cwd>/templates/<name>.json. */
  cwd: string
  api: ApiTarget
  /** A theme (id or name). Default: the main theme. */
  theme?: string
  quiet?: boolean
}

const TEMPLATE_FILE = /^templates\/((?:[a-z0-9][a-z0-9-]{0,63}\/){0,4}[a-z0-9][a-z0-9-]{0,63})\.json$/

/** Download a theme's templates into the theme repo (like `shopify theme pull`), so editor changes ship with the next push. */
export async function pull(opts: PullOptions): Promise<{ theme: string; templates: string[] }> {
  const client = createClient(opts.api)
  const { themes } = await client.listThemes()
  const theme = opts.theme !== undefined ? resolveTheme(themes, opts.theme) : themes.find((t) => t.role === 'main')
  if (!theme) throw new Error('nothing published yet (no main theme)')
  const manifestBytes = await client.readFile(theme.id, 'manifest.json')
  if (!manifestBytes) throw new Error(`theme ${theme.id} has no files yet`)
  const files = (JSON.parse(new TextDecoder().decode(manifestBytes)).files ?? {}) as Record<string, string>
  const templates = Object.keys(files).filter((f) => TEMPLATE_FILE.test(f)).sort()
  for (const file of templates) {
    const bytes = await client.readFile(theme.id, file)
    if (!bytes) throw new Error(`theme ${theme.id}: ${file} is missing`)
    const target = path.join(opts.cwd, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  if (!opts.quiet) console.log(`[puck-remote pull] ${templates.length} templates from ${theme.name} #${theme.id}`)
  return { theme: theme.id, templates }
}
