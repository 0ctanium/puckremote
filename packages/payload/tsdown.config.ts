import { library } from '../../tsdown.shared.ts'

export default library(
  {
    source: 'src/source.ts',
    auth: 'src/auth.ts',
    artifacts: 'src/artifacts.ts',
    plugin: 'src/plugin.ts',
    admin: 'src/admin/index.tsx',
    'admin/client': 'src/admin/client.tsx',
  },
  {
    // The client components are their own module ('use client' boundary); CSS stays an import for Next.
    banner: ({ fileName }) => (fileName === 'admin/client.js' ? "'use client';" : undefined),
    external: [/\.css$/, /^@puck-remote\/payload\//],
  },
)
