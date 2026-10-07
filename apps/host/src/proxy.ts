import { createProxy } from '@puck-remote/next/proxy'
import remoteConfig from '../puck-remote.config.ts'

export const proxy = createProxy(remoteConfig)

export const config = { matcher: ['/((?!_next/|api/|editor(?:/|$)|theme/|favicon\.ico).*)'] }
