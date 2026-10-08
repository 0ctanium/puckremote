import { library } from '../../tsdown.shared.ts'

export default library(
  {
    protocol: 'src/protocol.ts',
    frame: 'src/frame.tsx',
    bridge: 'src/bridge.tsx',
    server: 'src/server.ts',
    bin: 'src/bin.ts',
  },
  {
    banner: ({ fileName }) => (fileName === 'frame.js' ? "'use client';" : fileName === 'bin.js' ? '#!/usr/bin/env node' : undefined),
  },
)
