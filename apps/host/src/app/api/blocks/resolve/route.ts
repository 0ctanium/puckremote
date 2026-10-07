import { handleResolve } from '@/server/editor-rpc.ts'
import { getHost } from '@/server/host.ts'
import type { RenderSession } from '@/server/isolate-runner.ts'

/** Editor data RPC: body is { blockType, props, slug }. The spec always comes from the manifest. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const host = await getHost()
  const { manifest, runtime } = host.store.get()
  let session: Promise<RenderSession> | null = null
  try {
    const res = await handleResolve(body, {
      manifest,
      config: host.config,
      source: host.source,
      http: host.http,
      cache: host.cache,
      site: host.config.site,
      session: () => (session ??= runtime.session()),
    })
    return Response.json(res.json, { status: res.status, headers: { 'cache-control': 'no-store' } })
  } finally {
    if (session) (await (session as Promise<RenderSession>).catch(() => null))?.release()
  }
}
