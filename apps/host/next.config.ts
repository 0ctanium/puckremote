import path from 'node:path'
import { withPuckRemote } from '@puck-remote/next/config'

export default withPuckRemote({
  // Monorepo: let Turbopack follow pnpm workspace symlinks.
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  reactStrictMode: true,
  // Dev hostnames: admin pages on admin.localhost, the editor page on 127.0.0.1 (another site).
  allowedDevOrigins: ['*.localhost', '127.0.0.1'],
})
