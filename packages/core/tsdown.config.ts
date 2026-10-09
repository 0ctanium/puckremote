import { library } from '../../tsdown.shared.ts'

// tsconfig.build.json covers src only: the default tsconfig includes tests, which import other
// packages' sources, and the declaration build would write .d.ts files next to them.
export default library(
  {
    index: 'src/index.ts',
    config: 'src/server/config.ts',
    edge: 'src/edge.ts',
    react: 'src/react/index.ts',
    island: 'src/react/ThemeIsland.tsx',
    testing: 'src/testing/index.ts',
    // Worker process entry (launched by the worker pool; not a public import).
    'render-worker': 'src/server/runtime/render-worker.ts',
  },
  // The island component stays a separate 'use client' module (see puck-rsc.tsx).
  { tsconfig: 'tsconfig.build.json', deps: { neverBundle: ['@puck-remote/core/island'] } },
)
