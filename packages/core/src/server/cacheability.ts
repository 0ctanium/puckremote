/**
 * Lightweight template cacheability check for proxies/middleware: no isolate (it only decides a
 * response header; usesRequestParams is recomputed from the specs).
 * Importing this module never loads isolated-vm.
 */
import type { ArtifactStore } from '@puck-remote/sdk/host'
import { mainTheme } from './main-theme.ts'
import { analyzeSpecs, type QuerySpec } from './manifest-schema.ts'
import { readTemplate } from './templates.ts'

interface ArtifactInfo {
  files: Record<string, string>
  uncacheable: Set<string>
}

const memo = new WeakMap<ArtifactStore, Map<string, ArtifactInfo>>()

/** Manifest analysis of a theme version, memoized by `<theme>-<hash>` (a new push has a new hash). */
async function artifactInfo(artifacts: ArtifactStore, theme: string, hash: string): Promise<ArtifactInfo | null> {
  const perStore = memo.get(artifacts) ?? new Map<string, ArtifactInfo>()
  memo.set(artifacts, perStore)
  const key = `${theme}-${hash}`
  const hit = perStore.get(key)
  if (hit) return hit
  const bytes = await artifacts.readFile(theme, 'manifest.json')
  if (!bytes) return null
  const m = JSON.parse(new TextDecoder().decode(bytes))
  const uncacheable = new Set<string>()
  for (const [name, b] of Object.entries<{ data: Record<string, QuerySpec> }>(m.blocks ?? {})) {
    if (analyzeSpecs(b.data ?? {}).usesRequestParams) uncacheable.add(name)
  }
  if (m.root && analyzeSpecs(m.root.data ?? {}).usesRequestParams) uncacheable.add('__root')
  const info = { files: m.files ?? {}, uncacheable }
  perStore.set(key, info)
  return info
}

export async function templateCacheability(config: { artifacts: ArtifactStore }, name: string): Promise<{ cacheable: boolean; blocks: string[] } | null> {
  const main = await mainTheme(config.artifacts).catch(() => null)
  if (!main?.hash) return null
  const info = await artifactInfo(config.artifacts, main.id, main.hash).catch(() => null)
  if (!info) return null
  const template = await readTemplate(config.artifacts, main.id, info, name).catch(() => null)
  if (!template) return null
  const types = info.uncacheable
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
  walk(template.content)
  return { cacheable: found.size === 0, blocks: [...found] }
}

