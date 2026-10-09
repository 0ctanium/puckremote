import { createProxy } from '@puck-remote/next/proxy'
import remoteConfig from '../puck-remote.config.ts'

export const proxy = createProxy(remoteConfig)

// Every route except Next internals: the proxy sets security and cache headers per origin.
export const config = { matcher: ['/((?!_next/|favicon\.ico).*)'] }
