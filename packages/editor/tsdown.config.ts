import { library } from '../../tsdown.shared.ts'

export default library(
  {
    protocol: 'src/protocol.ts',
    frame: 'src/frame.tsx',
    bridge: 'src/bridge.tsx',
  },
  { platform: 'browser', banner: ({ fileName }) => (fileName === 'frame.js' ? "'use client';" : undefined) },
)
