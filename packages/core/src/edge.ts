/**
 * Edge/proxy-safe helpers (no isolate, no worker imports): request classification, page
 * cacheability and security headers. Use from middleware/proxies of any framework.
 */
export { pageCacheability, normalizeSlug } from './server/cacheability.ts'
export {
  classifyRequest,
  cspNonce,
  DEFAULT_SECURITY,
  normalizeOrigin,
  requestOrigin,
  securityHeaders,
  surfaceOf,
  WrongSurfaceError,
  type CspMode,
  type OriginsConfig,
  type SecurityPolicy,
  type Surface,
} from './server/surface.ts'
export { resolveSurfaces } from './server/config.ts'
