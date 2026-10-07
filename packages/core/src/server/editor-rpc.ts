/**
 * POST /api/blocks/resolve — the editor's data RPC. The client sends ONLY which block and its
 * props; the query spec always comes from the server-side manifest. Runs in 'draft' mode.
 */
import { z } from 'zod'
import type { Manifest } from './manifest-schema.ts'
import { resolvePageData, type QueryResult, type ResolveDeps } from './query/resolver.ts'

const bodySchema = z.object({
  blockType: z.string().max(100),
  props: z.record(z.string(), z.unknown()),
  slug: z.string().max(200).default('home'),
})
// z.object (not strictObject) silently drops anything else the client sends: spec, data, query, mode…

export async function handleResolve(
  body: unknown,
  deps: Omit<ResolveDeps, 'manifest'> & { manifest: Manifest; site: { name: string; locale: string } },
): Promise<{ status: number; json: { data?: Record<string, QueryResult>; error?: string; usesRequestParams?: boolean } }> {
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return { status: 400, json: { error: 'invalid body' } }
  const { blockType, props, slug } = parsed.data
  const meta = blockType === 'root' ? deps.manifest.root : Object.hasOwn(deps.manifest.blocks, blockType) ? deps.manifest.blocks[blockType] : null
  if (!meta) return { status: 404, json: { error: 'unknown block' } }
  const { byInstance } = await resolvePageData(
    {
      instances: [{ id: 'rpc', props: { ...meta.defaultProps, ...props }, meta }],
      // The editor has no request URL params; $query refs resolve to null in previews.
      env: { page: { slug, locale: deps.site.locale }, site: deps.site, query: {} },
      mode: 'draft',
    },
    deps,
  )
  return { status: 200, json: { data: byInstance.get('rpc') ?? {}, usesRequestParams: meta.usesRequestParams } }
}
