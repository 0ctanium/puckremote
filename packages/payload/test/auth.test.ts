/** payloadAuthorize / payloadUser: session cookie, API key, anonymous, other auth collections. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { payloadAuthorize, payloadUser } from '../src/auth.ts'
import { payloadFixture, type Fixture } from './fixture.ts'

let f: Fixture
beforeAll(async () => {
  f = await payloadFixture()
}, 60_000)
afterAll(() => f?.close())

const action = { kind: 'list' } as const

describe('payloadAuthorize', () => {
  it('allows admin users by cookie or API key; refuses anonymous requests and other auth collections', async () => {
    const authorize = payloadAuthorize({ payload: () => f.payload })
    expect(await authorize(f.as.admin(), action)).toBe(true)
    expect(await authorize(f.as.apiKey(), action)).toBe(true)
    expect(await authorize(f.as.anonymous(), action)).toBe(false)
    expect(await authorize(f.as.member(), action)).toBe(false)
  })

  it('can decides per action, never for anonymous requests', async () => {
    const seen: string[] = []
    const authorize = payloadAuthorize({ payload: f.payload, can: ({ user, action }) => (seen.push(`${user.collection}:${action.kind}`), action.kind === 'read') })
    expect(await authorize(f.as.member(), { kind: 'read' })).toBe(true)
    expect(await authorize(f.as.member(), { kind: 'deleteTheme' })).toBe(false)
    expect(await authorize(f.as.anonymous(), { kind: 'read' })).toBe(false)
    expect(seen).toEqual(['members:read', 'members:deleteTheme'])
  })
})

describe('payloadUser', () => {
  it('returns the request user or null', async () => {
    expect(await payloadUser(f.payload, f.as.admin())).toMatchObject({ email: 'admin@example.com', collection: 'users' })
    expect(await payloadUser(() => f.payload, f.as.anonymous())).toBeNull()
  })
})
