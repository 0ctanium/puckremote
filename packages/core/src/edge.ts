/**
 * Edge/proxy-safe helpers (no isolate, no worker imports): request classification, page
 * cacheability and security headers. Use from middleware/proxies of any framework.
 */
export { pageCacheability, normalizeSlug } from './server/cacheability.ts'
export { classifyRequest, normalizeOrigin, surfaceOf, WrongSurfaceError, type OriginsConfig, type Surface } from './server/surface.ts'
export { resolveSurfaces } from './server/config.ts'
