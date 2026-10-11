/**
 * The CLI's config file, `puck-remote.cli.ts` in the theme repo: where the host's artifacts API is
 * and how requests to it are made. The CLI has no auth of its own: add whatever the host's
 * `authorize` expects (a bearer token, an API key, a cookie, a signature…).
 *
 *   // puck-remote.cli.ts
 *   import { defineCliConfig } from '@puck-remote/cli/config'
 *   export default defineCliConfig({
 *     url: 'https://admin.example.com/api/themes',
 *     headers: { authorization: `Bearer ${process.env.DEPLOY_TOKEN}` },
 *   })
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type HeadersInit = Record<string, string>

export interface CliConfig {
  /** Base URL of the host's artifacts API, e.g. https://admin.example.com/api/themes */
  url?: string
  /** Added to every request; a function is called for each request (e.g. short-lived tokens). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  /** Sends a request (headers already added) and returns the response: full control (signing, mTLS, proxies). Default: global fetch. */
  fetch?: (request: Request) => Promise<Response>
  /** `puck-remote dev` settings. */
  dev?: {
    /** Live reload of preview pages after each push (a local SSE server). false: off. Default port 9293. */
    reload?: false | { port?: number }
  }
}

/** Typed identity for puck-remote.cli.ts. */
export function defineCliConfig(config: CliConfig): CliConfig {
  return config
}

/** Looked up in this order in the theme folder. */
export const CONFIG_FILES = ['puck-remote.cli.ts', 'puck-remote.cli.mts', 'puck-remote.cli.js', 'puck-remote.cli.mjs'] as const

/** The config of a theme folder (or of `file`), or `{}` when there is none. */
export async function loadCliConfig(opts: { cwd: string; file?: string }): Promise<CliConfig> {
  const file = opts.file ? path.resolve(opts.cwd, opts.file) : CONFIG_FILES.map((f) => path.join(opts.cwd, f)).find((f) => existsSync(f))
  if (!file) return {}
  if (!existsSync(file)) throw new Error(`no config file at ${file}`)
  // Node 26 strips TypeScript types natively: .ts configs need no loader.
  const mod = await import(pathToFileURL(file).href)
  const config = mod.default ?? mod
  if (!config || typeof config !== 'object') throw new Error(`${path.basename(file)} must export a config object (export default defineCliConfig({ … }))`)
  return config as CliConfig
}
