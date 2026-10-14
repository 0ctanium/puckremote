import { getPayload } from 'payload'
import config from './payload.config.ts'

/** The Payload instance (one per process), shared by the data source and the API's authorize. */
export const payload = () => getPayload({ config })
