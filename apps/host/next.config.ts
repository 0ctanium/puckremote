import path from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Native addon: must be required at runtime, never bundled.
  serverExternalPackages: ['isolated-vm'],
  turbopack: { root: path.resolve(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  reactStrictMode: true,
}

export default config
