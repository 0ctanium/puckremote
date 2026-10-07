import type { NextConfig } from 'next'

const PACKAGES = ['@poc/core', '@poc/next', '@poc/sdk']

/** Adds what the host needs: isolated-vm stays external (native addon), POC packages are transpiled. */
export function withPoc(config: NextConfig = {}): NextConfig {
  return {
    ...config,
    serverExternalPackages: [...new Set([...(config.serverExternalPackages ?? []), 'isolated-vm'])],
    transpilePackages: [...new Set([...(config.transpilePackages ?? []), ...PACKAGES])],
  }
}
