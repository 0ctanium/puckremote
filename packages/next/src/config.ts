import type { NextConfig } from 'next'

/**
 * Adds what the host needs to a Next config: isolated-vm (a native addon) must stay external to
 * the server bundle. The @puck-remote packages ship compiled ESM, so nothing needs transpiling.
 */
export function withPuckRemote(config: NextConfig = {}): NextConfig {
  return {
    ...config,
    serverExternalPackages: [...new Set([...(config.serverExternalPackages ?? []), 'isolated-vm'])],
  }
}
