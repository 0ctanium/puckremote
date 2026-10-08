/**
 * Editor rendering through the server: theme code never runs in the editor's browser realm.
 * Blocks ask for HTML via POST <api>/blocks/render; requests issued in the same tick are batched
 * into one call (one isolate session server-side), results are cached by input, and the last
 * HTML stays on screen while a newer render is in flight.
 */
import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../shared/urls.ts'

export interface RenderItem {
  kind: 'block' | 'root'
  name: string
  props: Record<string, unknown>
  data: Record<string, unknown>
}

export interface EditorEffect {
  kind: string
  url?: string
}

export type RemoteResult = { ok: true; html: string; nonce: string; effects: EditorEffect[] } | { ok: false; error: string }

export interface RemoteRenderer {
  /** Cached result for an item, if any (synchronous). */
  peek(item: RenderItem): RemoteResult | undefined
  /** Render an item (batched with others requested in the same tick). */
  request(item: RenderItem): Promise<RemoteResult>
  /** Seed the cache (SSR, tests). */
  prime(item: RenderItem, result: RemoteResult): void
}

/** Deterministic key: same inputs → same server output, so results are cacheable. */
export function renderKey(item: RenderItem): string {
  const stable = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
    if (v && typeof v === 'object') {
      return `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    }
    return JSON.stringify(v) ?? 'null'
  }
  return stable([item.kind, item.name, item.props, item.data])
}

const MAX_BATCH = 100
const MAX_CACHE = 500

export function createRemoteRenderer(opts: { apiRoute: string; slug: string; fetch?: typeof fetch }): RemoteRenderer {
  const doFetch = opts.fetch ?? fetch
  const cache = new Map<string, RemoteResult>()
  const inflight = new Map<string, Promise<RemoteResult>>()
  let queue: { key: string; item: RenderItem; resolve: (r: RemoteResult) => void }[] = []
  let scheduled = false

  const remember = (key: string, r: RemoteResult) => {
    cache.delete(key)
    cache.set(key, r)
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  }

  async function flush() {
    scheduled = false
    const batch = queue
    queue = []
    for (let i = 0; i < batch.length; i += MAX_BATCH) {
      const chunk = batch.slice(i, i + MAX_BATCH)
      let results: Record<string, RemoteResult> = {}
      try {
        const res = await doFetch(apiUrl(opts.apiRoute, 'blocks/render'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-puck-remote': '1' },
          body: JSON.stringify({ slug: opts.slug, items: chunk.map((q, n) => ({ key: String(n), ...q.item })) }),
        })
        if (!res.ok) throw new Error(`render failed (${res.status})`)
        results = (await res.json()).results ?? {}
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        chunk.forEach((q) => q.resolve({ ok: false, error }))
        continue
      }
      chunk.forEach((q, n) => {
        const r = results[String(n)] ?? { ok: false, error: 'missing result' }
        if (r.ok) remember(q.key, r)
        q.resolve(r)
      })
    }
  }

  return {
    peek: (item) => cache.get(renderKey(item)),
    prime: (item, result) => remember(renderKey(item), result),
    request(item) {
      const key = renderKey(item)
      const hit = cache.get(key)
      if (hit) return Promise.resolve(hit)
      const pending = inflight.get(key)
      if (pending) return pending
      const p = new Promise<RemoteResult>((resolve) => {
        queue.push({ key, item, resolve })
        if (!scheduled) {
          scheduled = true
          setTimeout(() => void flush(), 0)
        }
      }).finally(() => inflight.delete(key))
      inflight.set(key, p)
      return p
    },
  }
}

/**
 * Current render for an item. Shows the cached result immediately when available; otherwise keeps
 * the previous HTML while the new one is fetched (debounced, so typing doesn't spam the server).
 */
export function useRemoteRender(renderer: RemoteRenderer, item: RenderItem, debounceMs = 150): RemoteResult | undefined {
  const key = renderKey(item)
  const cached = renderer.peek(item)
  const [result, setResult] = useState<RemoteResult | undefined>(cached)
  const latest = useRef(key)
  latest.current = key

  useEffect(() => {
    if (renderer.peek(item)) return
    let cancelled = false
    const t = setTimeout(
      () => {
        void renderer.request(item).then((r) => {
          if (!cancelled && latest.current === key) setResult(r)
        })
      },
      result ? debounceMs : 0, // first render: no debounce
    )
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return cached ?? result
}
