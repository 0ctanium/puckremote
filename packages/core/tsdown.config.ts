import { library } from '../../tsdown.shared.ts'

export default library(
  {
  "index": "src/index.ts",
  "config": "src/server/config.ts",
  "cacheability": "src/server/cacheability.ts",
  "react": "src/react/index.ts",
  "editor": "src/editor/index.ts",
  "testing": "src/testing/index.ts",
  // Worker process entry (launched by the worker pool; not a public import).
  "render-worker": "src/server/runtime/render-worker.ts",
  },
  { banner: ({ fileName }) => (fileName === 'editor.js' ? "'use client';" : undefined) },
)
