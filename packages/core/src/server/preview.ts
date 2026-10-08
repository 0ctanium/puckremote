/**
 * Signed preview links (edge-safe: Web Crypto only).
 *
 *   token = base64url(JSON { s: slug, r: revision, e: expiry, unix seconds }) "." base64url(HMAC-SHA256)
 *
 * Stateless, so they work across instances; they can't be revoked one by one (rotate the secret).
 */

/** Query parameter carrying the token on the public site. */
export const PREVIEW_PARAM = 'puck_preview'

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

const key = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function createPreviewToken(secret: string, p: { slug: string; revision: string; ttlSeconds: number; now?: number }): Promise<{ token: string; expiresAt: string }> {
  const e = Math.floor((p.now ?? Date.now()) / 1000) + p.ttlSeconds
  const payload = b64url(enc.encode(JSON.stringify({ s: p.slug, r: p.revision, e })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)))
  return { token: `${payload}.${b64url(sig)}`, expiresAt: new Date(e * 1000).toISOString() }
}

/** The revision a valid token grants for this slug, or null (bad signature, other slug, expired, malformed). */
export async function verifyPreviewToken(secret: string, token: string, slug: string, now = Date.now()): Promise<string | null> {
  if (token.length > 2048) return null
  const [payload, sig, extra] = token.split('.')
  if (!payload || !sig || extra !== undefined) return null
  const sigBytes = fromB64url(sig)
  if (!sigBytes) return null
  // verify() compares in constant time.
  if (!(await crypto.subtle.verify('HMAC', await key(secret), sigBytes, enc.encode(payload)))) return null
  try {
    const raw = fromB64url(payload)
    const { s, r, e } = JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())) as { s: unknown; r: unknown; e: unknown }
    if (s !== slug || typeof r !== 'string' || typeof e !== 'number' || e * 1000 <= now) return null
    return r
  } catch {
    return null
  }
}
