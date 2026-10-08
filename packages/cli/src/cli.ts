import path from 'node:path'
import { parseArgs } from 'node:util'
import { build } from './build.ts'
import { activate, publish, pull } from './publish.ts'
import { BuildError } from './validate.ts'

const USAGE = `usage:
  puck-remote build   [--cwd .] [--out dist]
  puck-remote publish [--cwd .] [--out dist] --artifacts <dir>
  puck-remote pull    [--cwd .] --artifacts <dir> [--artifact <id>]   (pages → <cwd>/pages)
  puck-remote activate <id> --artifacts <dir>          (rollback = activate an older artifact)`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cwd: { type: 'string', default: process.cwd() },
      out: { type: 'string', default: 'dist' },
      artifacts: { type: 'string', default: process.env.PUCK_REMOTE_ARTIFACTS_DIR },
      artifact: { type: 'string' },
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
      await build({ cwd, outDir: values.out })
      break
    case 'publish':
      await publish({ distDir: path.resolve(cwd, values.out!), artifacts: artifactsDir() })
      break
    case 'pull':
      await pull({ cwd, artifacts: artifactsDir(), artifact: values.artifact })
      break
    case 'activate': {
      if (!arg) throw new Error('activate needs an artifact id')
      await activate(artifactsDir(), arg)
      console.log(`[puck-remote activate] current → ${arg}`)
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
