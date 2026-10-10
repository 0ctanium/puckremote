// Types the theme's find()/findByID()/global() calls against the host's data source, and the
// root props the host app adds to every template (its `root.fields`).
// Type-only: nothing from the source package ends up in the theme bundle.
import type { MockCms } from '@puck-remote/source-mock'

declare module '@puck-remote/sdk' {
  interface Register {
    source: MockCms
    rootProps: { title: string; description: string }
  }
}
