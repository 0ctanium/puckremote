/**
 * Lightweight page cacheability check for the proxy (no isolate, no hash verification needed:
 * it only decides a response header, and usesRequestParams is recomputed from the specs).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defaultHostConfig } from './config.ts'
import { analyzeSpecs, type QuerySpec } from './manifest-schema.ts'
import { readPage } from './pages.ts'

const memo = new Map<number, Set<string>>()

async function uncacheableTypes(artifactsDir: string): Promise<Set<string>> {
  const { version } = JSON.parse(await readFile(path.join(artifactsDir, 'current.json'), 'utf8'))
  const hit = memo.get(version)
  if (hit) return hit
  const m = JSON.parse(await readFile(path.join(artifactsDir, `v${version}`, 'manifest.json'), 'utf8'))
  const set = new Set<string>()
  for (const [name, b] of Object.entries<{ data: Record<string, QuerySpec> }>(m.blocks ?? {})) {
    if (analyzeSpecs(b.data ?? {}).usesRequestParams) set.add(name)
  }
  if (m.root && analyzeSpecs(m.root.data ?? {}).usesRequestParams) set.add('__root')
  memo.set(version, set)
  return set
}

export async function pageCacheability(slug: string): Promise<{ cacheable: boolean; blocks: string[] } | null> {
  const cfg = defaultHostConfig()
  const page = await readPage(cfg.pages, slug).catch(() => null)
  if (!page) return null
  const types = await uncacheableTypes(cfg.artifactsDir)
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
