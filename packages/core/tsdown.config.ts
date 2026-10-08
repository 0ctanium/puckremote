import { library } from '../../tsdown.shared.ts'

export default library(
  {
  "index": "src/index.ts",
  "config": "src/server/config.ts",
  "cacheability": "src/server/cacheability.ts",
  "react": "src/react/index.ts",
  "editor": "src/editor/index.ts",
  "testing": "src/testing/index.ts",
  },
  { banner: ({ fileName }) => (fileName === 'editor.js' ? "'use client';" : undefined) },
)
