import { normalizeSlug } from './template-name.ts'
import { createProxy } from '@puck-remote/next/proxy'
import remoteConfig from '../puck-remote.config.ts'

export const proxy = createProxy(remoteConfig, {
  // The same path → template mapping as the catch-all page, for the cache headers.
  template: (pathname) => {
    const name = normalizeSlug(pathname)
    return name ? { name } : null
  },
})

// Every route except Next internals: the proxy sets security and cache headers per origin.
export const config = { matcher: ['/((?!_next/|favicon\.ico).*)'] }
