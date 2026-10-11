/**
 * Theme helpers of the CLI, after Shopify CLI: generated names for development and shared themes,
 * `--theme <id|name>` resolution, and the per-device record of this machine's development theme.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Theme } from '@puck-remote/sdk/host'

/** Theme names are limited to 50 characters by the host, like Shopify's. */
export const THEME_NAME_LIMIT = 50

/**
 * `<context> (<6 hex>-<host name>)`, e.g. `Development (a3f9c1-macbook)`: the host name says which
 * device a theme belongs to, the random part keeps two machines with the same name apart (Shopify
 * CLI's generateThemeName).
 */
export function generateThemeName(context: string, hostname = os.hostname()): string {
  const host = hostname.split('.')[0] ?? ''
  const hash = randomBytes(3).toString('hex')
  const room = THEME_NAME_LIMIT - `${context} ()`.length - hash.length - 1
  const id = `${hash}-${host.slice(0, Math.max(0, room))}`.replace(/[^A-Za-z0-9-]/g, '-').replace(/-+$/, '')
  return `${context} (${id})`
}

/** The theme a `--theme` value names: an exact id first, then a unique name. */
export function resolveTheme(themes: Theme[], ref: string): Theme {
  const byId = themes.find((t) => t.id === ref)
  if (byId) return byId
  const byName = themes.filter((t) => t.name === ref)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) throw new Error(`several themes are named "${ref}": use an id (${byName.map((t) => t.id).join(', ')})`)
  throw new Error(`no theme "${ref}" (see "puck-remote list")`)
}

/** ${XDG_CONFIG_HOME:-~/.config}/puck-remote/dev-themes.json: this device's development theme per API. */
export function devThemesFile(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'puck-remote', 'dev-themes.json')
}

/** The key of an API in the dev-themes file: its URL without trailing slashes, origin lowercased. */
export function apiKey(url: string): string {
  const u = new URL(url)
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
}

async function readDevThemes(file: string): Promise<Record<string, string>> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8'))
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** The development theme id this device uses with an API, or null. */
export async function getDevTheme(url: string, file = devThemesFile()): Promise<string | null> {
  const id = (await readDevThemes(file))[apiKey(url)]
  return typeof id === 'string' ? id : null
}

/** Remember (or forget, with null) this device's development theme for an API. */
export async function setDevTheme(url: string, id: string | null, file = devThemesFile()): Promise<void> {
  const all = await readDevThemes(file)
  if (id) all[apiKey(url)] = id
  else delete all[apiKey(url)]
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(all, null, 2) + '\n')
  await rename(tmp, file)
}
