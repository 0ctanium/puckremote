import path from 'node:path'
import { withPayload } from '@payloadcms/next/withPayload'
import { withPuckRemote } from '@puck-remote/next/config'

export default withPayload(
  withPuckRemote({
    // Monorepo: let Turbopack follow pnpm workspace symlinks.
    turbopack: { root: path.resolve(import.meta.dirname, '../..') },
    outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
    reactStrictMode: true,
    // Dev hostnames: Payload's admin on admin.localhost, the editor page on 127.0.0.1 (another site).
    allowedDevOrigins: ['*.localhost', '127.0.0.1'],
  }),
  { devBundleServerPackages: false },
)
