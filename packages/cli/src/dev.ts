/**
 * `puck-remote dev`, like `shopify theme dev`: build and push to this device's development theme
 * on every change of the theme repo. The theme is created on first use, named after the device
 * (`Development (a3f9c1-macbook)`), and its id is remembered in a user-level file, so each device
 * keeps its own theme and parallel sessions never collide. A local SSE server tells preview pages
 * to reload after each push (live reload). Templates from the repo replace editor edits on that
 * theme; `pull --theme <id>` first.
 */
import { watch as fsWatch } from 'node:fs'
import path from 'node:path'
import { createClient, type ApiError, type ApiTarget } from './api-client.ts'
import { build } from './build.ts'
import { pushDist } from './diff.ts'
import { describePush } from './publish.ts'
import { startReloadServer, type ReloadServer } from './reload-server.ts'
import { devThemesFile, generateThemeName, getDevTheme, resolveTheme, setDevTheme } from './themes.ts'
import { BuildError } from './validate.ts'

export interface DevOptions {
  cwd: string
  outDir?: string
  api: ApiTarget
  /** Develop on this theme (id or name) instead of the device's development theme. */
  theme?: string
  /** Debounce of file changes. */
  debounceMs?: number
  /** Where the device's development theme id is kept. Default devThemesFile(). */
  devThemesFile?: string
  /** Device name used in a new development theme's name. Default: the OS host name. */
  hostname?: string
  /** Live reload of preview pages (local SSE server). false: off. Default port 9293. */
  reload?: false | { port?: number }
  log?: Pick<Console, 'log' | 'error'>
}

const DEBOUNCE_MS = 300

/**
 * Starts watching; resolves after the first push. Errors of the first push other than build errors
 * (e.g. a single-theme site) reject. `close()` stops (the theme is kept).
 */
export async function dev(opts: DevOptions): Promise<{
  theme: { id: string; name: string }
  previewUrl?: string
  /** The live reload server's URL (http://127.0.0.1:<port>), when on. */
  reloadUrl?: string
  pushes: () => number
  close: () => Promise<void>
}> {
  const log = opts.log ?? console
  const client = createClient(opts.api)
  const file = opts.devThemesFile ?? devThemesFile()
  const outDir = opts.outDir ?? 'dist'
  const outAbs = path.resolve(opts.cwd, outDir)
  let pushes = 0
  let theme: { id: string; name: string } | null = null
  let previewUrl: string | undefined

  const reloader: ReloadServer | null = opts.reload === false ? null : await startReloadServer({ port: opts.reload?.port })

  if (opts.theme !== undefined) {
    const t = resolveTheme((await client.listThemes()).themes, opts.theme)
    theme = { id: t.id, name: t.name }
  }

  /** The device's development theme, created if it is gone (expired, deleted). */
  const target = async (): Promise<string> => {
    if (theme) return theme.id
    const saved = await getDevTheme(opts.api.url, file)
    if (saved && (await client.getTheme(saved))) return saved
    const created = await client.createTheme({ name: generateThemeName('Development', opts.hostname), role: 'development' })
    await setDevTheme(opts.api.url, created.theme.id, file)
    return created.theme.id
  }

  /** The theme's hash after our last push: a push refused with 409 means someone else changed it. */
  let lastHash: string | undefined
  const send = async (id: string, dist: string) => {
    try {
      return await pushDist(client, id, dist, lastHash ? { expect: lastHash } : {})
    } catch (e) {
      if ((e as ApiError)?.status !== 409) throw e
      // Changed elsewhere (an editor save, another push): diff against its current files once more.
      return pushDist(client, id, dist)
    }
  }

  const push = async (first: boolean) => {
    try {
      const { outDir: dist } = await build({ cwd: opts.cwd, outDir })
      const id = await target()
      const r = await send(id, dist)
      theme = { id: r.theme.id, name: r.theme.name }
      lastHash = r.theme.hash ?? undefined
      previewUrl = r.previewUrl ?? previewUrl
      pushes++
      log.log(`[puck-remote dev] ${describePush(r)}`)
      reloader?.reload({ theme: r.theme.id, hash: r.theme.hash ?? '' })
    } catch (e) {
      if (first && !(e instanceof BuildError)) {
        await reloader?.close()
        throw e
      }
      // The theme keeps its last good artifact.
      log.error(e instanceof BuildError ? `[puck-remote dev] ✖ build failed: ${e.message}` : `[puck-remote dev] ✖ ${(e as Error).message}`)
    }
  }

  // One push at a time; changes during a push trigger one more.
  let running: Promise<void> | null = null
  let again = false
  const run = (): Promise<void> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await push(false)
      } while (again)
    })().finally(() => (running = null))
    return running
  }

  await push(true)
  // The preview route keeps the reload URL in a cookie; preview pages then listen to it.
  if (previewUrl && reloader) previewUrl = `${previewUrl}&reload=${encodeURIComponent(reloader.url)}`
  if (previewUrl) log.log(`[puck-remote dev] preview: ${previewUrl}`)
  if (reloader) log.log(`[puck-remote dev] live reload on ${reloader.url}`)
  log.log(`[puck-remote dev] watching ${opts.cwd}${reloader ? '' : ' (refresh the page after a push)'}`)

  let timer: NodeJS.Timeout | null = null
  const ignored = (rel: string) => {
    const abs = path.resolve(opts.cwd, rel)
    if (abs === outAbs || abs.startsWith(outAbs + path.sep)) return true
    const first = rel.split(/[\\/]/)[0]
    return first === 'node_modules' || first.startsWith('.')
  }
  const watcher = fsWatch(opts.cwd, { recursive: true }, (_ev, f) => {
    if (!f || ignored(f.toString())) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), opts.debounceMs ?? DEBOUNCE_MS)
  })

  return {
    theme: theme ?? { id: '', name: '' },
    previewUrl,
    reloadUrl: reloader?.url,
    pushes: () => pushes,
    close: async () => {
      if (timer) clearTimeout(timer)
      watcher.close()
      await reloader?.close()
    },
  }
}

/** Delete this device's development theme (`delete --development`) and forget it. */
export async function deleteDevTheme(api: ApiTarget, opts: { devThemesFile?: string } = {}): Promise<string | null> {
  const file = opts.devThemesFile ?? devThemesFile()
  const id = await getDevTheme(api.url, file)
  if (!id) return null
  const client = createClient(api)
  if (await client.getTheme(id)) await client.deleteTheme(id)
  await setDevTheme(api.url, null, file)
  return id
}
