import type { NextConfig } from 'next'

const PACKAGES = ['@puck-remote/core', '@puck-remote/next', '@puck-remote/sdk']

/** Adds what the host needs: isolated-vm stays external (native addon), @puck-remote packages are transpiled. */
export function withPuckRemote(config: NextConfig = {}): NextConfig {
  return {
    ...config,
    serverExternalPackages: [...new Set([...(config.serverExternalPackages ?? []), 'isolated-vm'])],
    transpilePackages: [...new Set([...(config.transpilePackages ?? []), ...PACKAGES])],
  }
}
