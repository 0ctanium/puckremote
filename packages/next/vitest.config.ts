import { defineConfig } from 'vitest/config'

// Resolve workspace packages to their TypeScript sources (see the "@puck-remote/source" export condition).
// Vite's default server conditions, prefixed with our source condition.
const conditions = ['@puck-remote/source', 'module', 'node', 'development|production']

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
})
