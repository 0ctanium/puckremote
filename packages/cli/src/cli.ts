import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { ThemeRole } from '@puck-remote/sdk/host'
import type { ApiTarget } from './api-client.ts'
import { build } from './build.ts'
import { loadCliConfig } from './config.ts'
import { deleteDevTheme, dev } from './dev.ts'
import { writePackage } from './package.ts'
import { deleteTheme, duplicateTheme, listThemes, publish, pull, push, renameTheme, share } from './publish.ts'
import { BuildError } from './validate.ts'

const USAGE = `usage:
  puck-remote build      [--cwd .] [--out dist]
  puck-remote package    [--cwd .] [--out dist] [--file <name>-<hash>.tar.gz]
  puck-remote push       [-t <id|name> | --live | --unpublished] [--name <name>] [--file <package>]   (only changed files are sent)
  puck-remote publish    -t <id|name>                       (make it the main theme)
  puck-remote pull       [-t <id|name>]                     (templates → <cwd>/templates; default: main theme)
  puck-remote dev        [-t <id|name>]                     (default: this device's development theme)
  puck-remote list       [--role main|unpublished|development]
  puck-remote rename     -t <id|name> --name <name>
  puck-remote delete     -t <id|name> | --development
  puck-remote duplicate  -t <id|name> [--name <name>]
  puck-remote share                                         (new unpublished theme + preview link)

API commands read puck-remote.cli.ts in --cwd (or --config <file>): the API url and the headers or
fetch the host needs. --url (or PUCK_REMOTE_URL) overrides the url. dev: --no-reload turns live reload off.`

function packageName(cwd: string): string | undefined {
  const file = path.join(cwd, 'package.json')
  if (!existsSync(file)) return undefined
  const name = JSON.parse(readFileSync(file, 'utf8')).name
  return typeof name === 'string' && name ? name : undefined
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.cwd() },
      out: { type: 'string', default: 'dist' },
      url: { type: 'string', default: process.env.PUCK_REMOTE_URL },
      file: { type: 'string' },
      theme: { type: 'string', short: 't' },
      live: { type: 'boolean' },
      unpublished: { type: 'boolean' },
      development: { type: 'boolean' },
      name: { type: 'string' },
      role: { type: 'string' },
      config: { type: 'string' },
      'no-reload': { type: 'boolean' },
    },
  })
  const cwd = path.resolve(values.cwd!)
  const [cmd] = positionals
  // Only API commands need the config (build and package work without one).
  let configP: ReturnType<typeof loadCliConfig> | null = null
  const config = () => (configP ??= loadCliConfig({ cwd, file: values.config }))
  const api = async (): Promise<ApiTarget> => {
    const c = await config()
    return { url: values.url ?? c.url ?? '', headers: c.headers, fetch: c.fetch }
  }
  const theme = () => {
    if (!values.theme) throw new Error(`${cmd} needs -t <id|name>`)
    return values.theme
  }
  const source = async () =>
    values.file ? { file: path.resolve(cwd, values.file) } : { distDir: (await build({ cwd, outDir: values.out })).outDir }
  switch (cmd) {
    case 'build':
      await build({ cwd, outDir: values.out })
      break
    case 'package': {
      const { outDir } = await build({ cwd, outDir: values.out })
      await writePackage({ distDir: outDir, cwd, file: values.file && path.resolve(cwd, values.file) })
      break
    }
    case 'push':
      await push({ api: await api(), ...(await source()), theme: values.theme, live: values.live, unpublished: values.unpublished, name: values.name, packageName: packageName(cwd) })
      break
    case 'publish':
      await publish(await api(), theme())
      break
    case 'pull':
      await pull({ cwd, api: await api(), theme: values.theme })
      break
    case 'dev': {
      const reload = values['no-reload'] ? false : (await config()).dev?.reload
      const d = await dev({ cwd, outDir: values.out, api: await api(), theme: values.theme, reload })
      const stop = () => void d.close().finally(() => process.exit(0))
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      break
    }
    case 'list':
      for (const t of await listThemes(await api(), values.role ? { role: values.role as ThemeRole } : {}))
        console.log(`${t.id}  ${t.role.padEnd(11)}  ${t.updatedAt.slice(0, 16).replace('T', ' ')}  ${t.name}`)
      break
    case 'rename': {
      if (!values.name) throw new Error('rename needs --name <name>')
      const r = await renameTheme(await api(), theme(), values.name)
      console.log(`[puck-remote rename] #${r.theme.id} → ${r.theme.name}`)
      break
    }
    case 'delete': {
      if (values.development) {
        const id = await deleteDevTheme(await api())
        console.log(id ? `[puck-remote delete] development theme #${id} deleted` : '[puck-remote delete] this device has no development theme')
        break
      }
      const t = await deleteTheme(await api(), theme())
      console.log(`[puck-remote delete] ${t.name} #${t.id} deleted`)
      break
    }
    case 'duplicate': {
      const r = await duplicateTheme(await api(), theme(), values.name ? { name: values.name } : {})
      console.log(`[puck-remote duplicate] ${r.theme.name} #${r.theme.id}${r.previewUrl ? `\n  preview: ${r.previewUrl}` : ''}`)
      break
    }
    case 'share':
      await share({ api: await api(), ...(await source()) })
      break
    default:
      console.error(USAGE)
      process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof BuildError ? `\n✖ build failed: ${e.message}\n` : e instanceof Error ? `✖ ${e.message}` : e)
  process.exit(1)
})
