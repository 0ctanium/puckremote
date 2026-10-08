import type { NextConfig } from 'next'

/**
 * Adds what the host needs to a Next config: isolated-vm (a native addon) and the core (it forks
 * render workers from its own files) must stay external to the server bundle. The @puck-remote
 * packages ship compiled ESM, so nothing needs transpiling.
 */
export function withPuckRemote(config: NextConfig = {}): NextConfig {
  return {
    ...config,
    // The core forks its render workers from its own dist directory, so Next must load it from
    // node_modules rather than bundling it.
    serverExternalPackages: [...new Set([...(config.serverExternalPackages ?? []), 'isolated-vm', '@puck-remote/core'])],
  }
}
