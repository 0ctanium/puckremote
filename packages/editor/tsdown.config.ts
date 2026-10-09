import { library } from '../../tsdown.shared.ts'

export default library(
  {
    protocol: 'src/protocol.ts',
    frame: 'src/frame.tsx',
    react: 'src/react.tsx',
  },
  { banner: ({ fileName }) => (fileName === 'frame.js' || fileName === 'react.js' ? "'use client';" : undefined) },
)
