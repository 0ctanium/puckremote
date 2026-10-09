/** The origin the client addressed (used to tell admin requests from public-site ones). */
import { describe, expect, it } from 'vitest'
import { requestOrigin } from '../src/server/surface.ts'

describe('requestOrigin', () => {
  it('uses the addressed host (X-Forwarded-Host/Proto, then Host) over the server-built URL', () => {
    expect(requestOrigin(new Request('http://localhost:3100/admin', { headers: { 'x-forwarded-host': 'admin.localhost:3100', 'x-forwarded-proto': 'http' } }))).toBe('http://admin.localhost:3100')
    expect(requestOrigin(new Request('http://localhost:3100/', { headers: { host: 'www.example.test', 'x-forwarded-proto': 'https' } }))).toBe('https://www.example.test')
    expect(requestOrigin(new Request('http://localhost:3100/', { headers: { host: 'bad host/../x' } }))).toBe('http://localhost:3100')
    expect(requestOrigin(new Request('https://a.test/'))).toBe('https://a.test')
  })
})
