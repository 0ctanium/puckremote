interface Entry {
  value: unknown
  expires: number
  tags: string[]
}

/** In-memory cache: TTL entries (http/adapters) and tag-invalidated entries (payload). */
export class QueryCache {
  private entries = new Map<string, Entry>()

  get(key: string): { hit: true; value: unknown } | { hit: false } {
    const e = this.entries.get(key)
    if (!e) return { hit: false }
    if (e.expires < Date.now()) {
      this.entries.delete(key)
      return { hit: false }
    }
    return { hit: true, value: e.value }
  }

  set(key: string, value: unknown, opts: { ttlMs?: number; tags?: string[] }): void {
    this.entries.set(key, { value, expires: opts.ttlMs ? Date.now() + opts.ttlMs : Number.POSITIVE_INFINITY, tags: opts.tags ?? [] })
  }

  invalidate(tag: string): number {
    let n = 0
    for (const [k, e] of this.entries) {
      if (e.tags.includes(tag)) {
        this.entries.delete(k)
        n++
      }
    }
    return n
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
