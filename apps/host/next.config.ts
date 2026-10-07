import path from 'node:path'
import { withPoc } from '@poc/next/config'

export default withPoc({
  // Monorepo: let Turbopack follow pnpm workspace symlinks.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  reactStrictMode: true,
})
