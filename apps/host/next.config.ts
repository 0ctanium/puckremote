import path from 'node:path'
import { withPuckRemote } from '@puck-remote/next/config'

export default withPuckRemote({
  // Monorepo: let Turbopack follow pnpm workspace symlinks.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  reactStrictMode: true,
  // The editor runs on editor.localhost in development (separate origin from the site).
  allowedDevOrigins: ['*.localhost'],
})
