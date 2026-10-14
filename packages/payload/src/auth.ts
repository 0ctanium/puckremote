/**
 * `@puck-remote/payload/auth` — Payload users for the app's routes:
 *
 *  - payloadAuthorize(): the `authorize` of the artifacts API (`/api/themes`, what the CLI pushes
 *    through). The CLI authenticates with a Payload API key (`Authorization: <users> API-Key <key>`,
 *    sent by puck-remote.cli.ts) or the browser's session cookie;
 *  - payloadUser(): the request's user, for server actions and admin pages.
 */
import type { ApiAction, AuthorizeApi } from '@puck-remote/sdk/host'
import type { Payload } from 'payload'
import type { PayloadUser } from './source.ts'

export type { PayloadUser }

type PayloadGetter = Payload | (() => Payload | Promise<Payload>)

const resolve = (p: PayloadGetter) => Promise.resolve(typeof p === 'function' ? p() : p)

/** The Payload user of a request (session cookie or API key), or null. */
export async function payloadUser(payload: PayloadGetter, request: Request): Promise<PayloadUser | null> {
  const { user } = await (await resolve(payload)).auth({ headers: request.headers })
  return (user as PayloadUser | null) ?? null
}

export interface PayloadAuthorizeOptions {
  payload: PayloadGetter
  /** Who may do what. Default: any user of the admin user collection (`config.admin.user`). Anonymous requests are always refused. */
  can?: (args: { user: PayloadUser; action: ApiAction; request: Request }) => boolean | Promise<boolean>
}

/** `authorize` for createArtifactsHandler / handleArtifactsApi, backed by Payload users. */
export function payloadAuthorize(opts: PayloadAuthorizeOptions): AuthorizeApi {
  return async (request, action) => {
    const payload = await resolve(opts.payload)
    const user = await payloadUser(payload, request)
    if (!user) return false
    if (opts.can) return opts.can({ user, action, request })
    return user.collection === payload.config.admin.user
  }
}
