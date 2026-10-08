import type { CacheStore } from '@puck-remote/sdk/host'

interface Entry {
  value: unknown
  expires: number
  tags: string[]
}

export type MemoryCache = CacheStore & { readonly size: number; clear(): void }

/**
 * Default CacheStore: in-process memory. Each runtime is a process-wide singleton (see
 * createCore), so this is effectively a globalThis cache. Not shared across instances: use a
 * shared store (Redis…) when running several servers.
 */
export function memoryCache(opts: { maxEntries?: number } = {}): MemoryCache {
  const max = opts.maxEntries ?? 10_000
  const entries = new Map<string, Entry>()
  return {
    async get(key) {
      const e = entries.get(key)
      if (!e) return undefined
      if (e.expires < Date.now()) {
        entries.delete(key)
        return undefined
      }
      return e.value
    },
    async set(key, value, { ttlMs, tags = [] }) {
      if (value === undefined) return
      entries.delete(key)
      entries.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : Number.POSITIVE_INFINITY, tags })
      // Oldest-first eviction (Map preserves insertion order).
      while (entries.size > max) entries.delete(entries.keys().next().value!)
    },
    async invalidateTags(tags) {
      for (const [k, e] of entries) if (e.tags.some((t) => tags.includes(t))) entries.delete(k)
    },
    get size() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
  }
}
