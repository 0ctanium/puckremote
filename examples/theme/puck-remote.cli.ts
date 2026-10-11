/**
 * How the CLI reaches the example app's artifacts API. The CLI has no auth of its own: this sends
 * the bearer token the app's `authorize` checks (examples/app, PUCK_REMOTE_DEPLOY_TOKEN). Any other
 * header, cookie or signature works the same way (or take over with `fetch`).
 */
import { defineCliConfig } from '@puck-remote/cli/config'

export default defineCliConfig({
  url: 'http://admin.localhost:3100/api/themes',
  // `dev-token` is the app's local development fallback; set the variable for anything else.
  headers: { authorization: `Bearer ${process.env.PUCK_REMOTE_DEPLOY_TOKEN ?? 'dev-token'}` },
})
