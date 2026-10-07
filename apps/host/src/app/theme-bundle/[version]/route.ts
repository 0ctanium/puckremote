import { defaultHostConfig } from '@/server/config.ts'
import { fileResponse, readArtifactFile } from '@/server/static-files.ts'

/**
 * /theme-bundle/v<N> → artifacts/v<N>/bundle.js, for the EDITOR (browser) only. The server
 * never evaluates this file outside the isolate; it is served as bytes.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ version: string }> }) {
  const { version } = await ctx.params
  const f = await readArtifactFile(defaultHostConfig().artifactsDir, version, 'bundle.js')
  return fileResponse(f && { ...f, type: 'text/javascript; charset=utf-8' })
}
