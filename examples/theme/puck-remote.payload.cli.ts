/**
 * How the CLI reaches examples/payload's artifacts API: a Payload API key of an admin user
 * (`pnpm release:payload`). The app's authorize asks Payload who the key belongs to.
 */
import { defineCliConfig } from '@puck-remote/cli/config'

export default defineCliConfig({
  url: 'http://admin.localhost:3300/api/themes',
  // `dev-api-key` is the key `pnpm --filter payload-example seed` gives the demo admin locally.
  headers: { authorization: `users API-Key ${process.env.PAYLOAD_API_KEY ?? 'dev-api-key'}` },
})
