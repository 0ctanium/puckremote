/**
 * Lightweight page cacheability check for proxies/middleware: no isolate, no hash verification
 * (it only decides a response header; usesRequestParams is recomputed from the specs).
 * Importing this module never loads isolated-vm.
 */
import type { ArtifactStore, PageStore } from '@puck-remote/sdk/host'
import { analyzeSpecs, type QuerySpec } from './manifest-schema.ts'
import { readPublished } from './pages.ts'

const memo = new WeakMap<ArtifactStore, Map<number, Set<string>>>()

async function uncacheableTypes(artifacts: ArtifactStore): Promise<Set<string>> {
  const version = await artifacts.readPointer()
  if (!version) return new Set()
  const perStore = memo.get(artifacts) ?? new Map<number, Set<string>>()
  memo.set(artifacts, perStore)
  const hit = perStore.get(version)
  if (hit) return hit
  const bytes = await artifacts.readFile(version, 'manifest.json')
  if (!bytes) return new Set()
  const m = JSON.parse(new TextDecoder().decode(bytes))
  const set = new Set<string>()
  for (const [name, b] of Object.entries<{ data: Record<string, QuerySpec> }>(m.blocks ?? {})) {
    if (analyzeSpecs(b.data ?? {}).usesRequestParams) set.add(name)
  }
  if (m.root && analyzeSpecs(m.root.data ?? {}).usesRequestParams) set.add('__root')
  perStore.set(version, set)
  return set
}

export async function pageCacheability(
  config: { artifacts: ArtifactStore; pages: PageStore },
  slug: string,
): Promise<{ cacheable: boolean; blocks: string[] } | null> {
  const page = await readPublished(config.pages, slug).catch(() => null)
  if (!page) return null
  const types = await uncacheableTypes(config.artifacts)
  const found = new Set<string>()
  if (types.has('__root')) found.add('root')
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const { type, props } = it as { type: string; props?: Record<string, unknown> }
      if (types.has(type)) found.add(type)
      for (const v of Object.values(props ?? {})) if (Array.isArray(v)) walk(v)
    }
  }
  walk(page.content)
  return { cacheable: found.size === 0, blocks: [...found] }
}

export { normalizeSlug } from './pages.ts'
