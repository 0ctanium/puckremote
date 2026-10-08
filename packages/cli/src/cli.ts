import path from 'node:path'
import { parseArgs } from 'node:util'
import { build } from './build.ts'
import { activate, publish } from './publish.ts'
import { BuildError } from './validate.ts'

const USAGE = `usage:
  puck-remote build   [--cwd .] [--out dist] [--baseline <old manifest.json>]
  puck-remote publish [--cwd .] [--out dist] --artifacts <dir> [--force]
  puck-remote activate <version> --artifacts <dir>     (rollback = activate an older version)`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.cwd() },
      out: { type: 'string', default: 'dist' },
      artifacts: { type: 'string', default: process.env.PUCK_REMOTE_ARTIFACTS_DIR },
      baseline: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  })
  const cwd = path.resolve(values.cwd!)
  const [cmd, arg] = positionals
  const artifactsDir = () => {
    if (!values.artifacts) throw new Error('--artifacts <dir> (or PUCK_REMOTE_ARTIFACTS_DIR) is required')
    return path.resolve(cwd, values.artifacts)
  }
  switch (cmd) {
    case 'build':
      await build({ cwd, outDir: values.out, baseline: values.baseline })
      break
    case 'publish':
      await publish({ distDir: path.resolve(cwd, values.out!), artifacts: artifactsDir(), force: values.force })
      break
    case 'activate': {
      const v = Number(arg)
      if (!Number.isInteger(v) || v < 1) throw new Error('activate needs a version number')
      await activate(artifactsDir(), v)
      console.log(`[puck-remote activate] current → v${v}`)
      break
    }
    default:
      console.error(USAGE)
      process.exit(2)
  }
}

main().catch((e) => {
  console.error(e instanceof BuildError ? `\n✖ build failed: ${e.message}\n` : e)
  process.exit(1)
})
