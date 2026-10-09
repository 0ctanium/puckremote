/**
 * Edge/proxy-safe helpers (no isolate, no worker imports): page cacheability and security
 * headers. Use from middleware/proxies of any framework.
 */
export { pageCacheability, normalizeSlug } from './server/cacheability.ts'
export { cspNonce, DEFAULT_SECURITY, normalizeOrigin, requestOrigin, securityHeaders, type CspMode, type SecurityPolicy, type Surface } from './server/surface.ts'
