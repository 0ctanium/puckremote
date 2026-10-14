import { createPuckRemote } from '@puck-remote/next'
import config from '../puck-remote.config.ts'

export const remote = createPuckRemote(config)
