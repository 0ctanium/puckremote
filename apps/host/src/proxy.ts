import { createProxy } from '@poc/next/proxy'
import pocConfig from '../poc.config.ts'

export const proxy = createProxy(pocConfig)

export const config = { matcher: ['/((?!_next/|api/|editor(?:/|$)|theme/|favicon\.ico).*)'] }
