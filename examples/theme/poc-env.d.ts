// Types the theme's find()/findByID()/global() calls against the host's data source.
// Type-only: nothing from the source package ends up in the theme bundle.
import type { MockCms } from '@poc/source-mock'

declare module '@poc/sdk' {
  interface Register {
    source: MockCms
  }
}
