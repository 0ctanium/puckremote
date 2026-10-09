/**
 * Data for one block in draft mode: the editor's resolveData, called by the host app's RPC
 * handler. The caller sends ONLY which block and its props; the query spec always comes from the
 * server-side manifest.
 */
import { z } from 'zod'
import type { Manifest } from './manifest-schema.ts'
import { resolvePageData, type QueryResult, type ResolveDeps } from './query/resolver.ts'

// z.object (not strictObject) silently drops anything else the caller sends: spec, data, query, mode…
export const blockDataSchema = z.object({
  slug: z.string().max(200),
  block: z.string().max(100),
  props: z.record(z.string(), z.unknown()),
})

export interface BlockDataResult {
  data: Record<string, QueryResult>
  usesRequestParams: boolean
}

export class UnknownBlockError extends Error {
  constructor(block: string) {
    super(`unknown block ${block}`)
    this.name = 'UnknownBlockError'
  }
}

export async function resolveBlock(
  input: z.infer<typeof blockDataSchema>,
  deps: Omit<ResolveDeps, 'manifest'> & { manifest: Manifest; site: { name: string; locale: string } },
): Promise<BlockDataResult> {
  const { block, props, slug } = input
  const meta = block === 'root' ? deps.manifest.root : Object.hasOwn(deps.manifest.blocks, block) ? deps.manifest.blocks[block] : null
  if (!meta) throw new UnknownBlockError(block)
  const { byInstance } = await resolvePageData(
    {
      instances: [{ id: 'rpc', props: { ...meta.defaultProps, ...props }, meta }],
      // The editor has no request URL params; $query refs resolve to null in previews.
      env: { page: { slug, locale: deps.site.locale }, site: deps.site, query: {} },
      mode: 'draft',
    },
    deps,
  )
  return { data: byInstance.get('rpc') ?? {}, usesRequestParams: meta.usesRequestParams }
}
