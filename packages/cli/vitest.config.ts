import { defineConfig } from 'vitest/config'

// Vite's default server conditions, prefixed with our source condition.
const conditions = ['@puck-remote/source', 'module', 'node', 'development|production']

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
})
