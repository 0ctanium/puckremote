/** Security headers per surface, and the theme script/style origin allowlist. */
import { describe, expect, it } from 'vitest'
import { mergeEffects } from '../src/server/render.ts'
import { cspNonce, DEFAULT_SECURITY, securityHeaders } from '../src/server/surface.ts'

describe('securityHeaders', () => {
  const nonce = cspNonce()
  it('admin: enforced strict CSP, never framed, frames only the editor origin', () => {
    const h = securityHeaders('admin', { nonce, editorOrigin: 'https://editor.example.net' })
    const csp = h['content-security-policy']
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('frame-src https://editor.example.net;')
    expect(securityHeaders('admin', { nonce })['content-security-policy']).toContain("frame-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['x-content-type-options']).toBe('nosniff')
  })
  it('site: report-only by default, nonce + allowlisted origins, configurable framing', () => {
    const h = securityHeaders('site', { nonce, policy: { ...DEFAULT_SECURITY, scriptOrigins: ['https://cdn.example.test'], frameAncestors: ["'none'"] } })
    expect(h['content-security-policy']).toBeUndefined()
    const csp = h['content-security-policy-report-only']
    expect(csp).toContain(`'nonce-${nonce}'`)
    expect(csp).toContain('https://cdn.example.test')
    expect(csp).toContain("frame-ancestors 'none'")
    const enforced = securityHeaders('site', { nonce, policy: { ...DEFAULT_SECURITY, csp: { admin: 'enforce', site: 'enforce', editor: 'enforce' } } })
    expect(enforced['content-security-policy']).toBeDefined()
  })
  it('editor: enforced, framed by host origins only, nonce scripts plus the host theme route, no referrer', () => {
    const h = securityHeaders('editor', { nonce, hostOrigins: ['https://admin.example.com'] })
    const csp = h['content-security-policy']
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://admin.example.com`)
    expect(csp).toContain('frame-ancestors https://admin.example.com')
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['x-frame-options']).toBeUndefined()
    expect(securityHeaders('editor', { nonce })['content-security-policy']).toContain("frame-ancestors 'none'")
  })
  it('dev relaxes only what dev servers need', () => {
    const csp = securityHeaders('admin', { nonce, dev: true })['content-security-policy']
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain('ws:')
  })
  it('nonces are fresh and 128-bit', () => {
    expect(cspNonce()).not.toBe(cspNonce())
    expect(atob(cspNonce())).toHaveLength(16)
  })
})

describe('theme effects allowlist', () => {
  const base = '/theme/v1/assets/'
  const effects = [
    [
      { kind: 'script' as const, url: '/theme/v1/assets/a.js', opts: { defer: true, async: false, module: false } },
      { kind: 'script' as const, url: 'https://cdn.example.test/lib.js', opts: { defer: false, async: true, module: false } },
      { kind: 'script' as const, url: 'https://evil.test/x.js', opts: { defer: false, async: false, module: false } },
      { kind: 'script' as const, url: 'http://cdn.example.test/insecure.js', opts: { defer: false, async: false, module: false } },
      { kind: 'style' as const, url: 'https://fonts.example.test/f.css' },
      { kind: 'style' as const, url: '/theme/v1/assets/t.css' },
    ],
  ]
  it('keeps own assets and allowlisted https origins only', () => {
    const none = mergeEffects(effects, base)
    expect(none.scripts.map((s) => s.url)).toEqual(['/theme/v1/assets/a.js'])
    expect(none.styles).toEqual(['/theme/v1/assets/t.css'])
    const some = mergeEffects(effects, base, { scriptOrigins: ['https://cdn.example.test'], styleOrigins: ['https://fonts.example.test'] })
    expect(some.scripts.map((s) => s.url)).toEqual(['/theme/v1/assets/a.js', 'https://cdn.example.test/lib.js'])
    expect(some.styles).toEqual(['https://fonts.example.test/f.css', '/theme/v1/assets/t.css'])
  })
})
