import { defaultHostConfig } from '@/server/config.ts'
import { fileResponse, readArtifactFile } from '@/server/static-files.ts'

/** /theme-assets/v<N>/** → artifacts/v<N>/assets/** */
export async function GET(_req: Request, ctx: { params: Promise<{ version: string; path: string[] }> }) {
  const { version, path } = await ctx.params
  return fileResponse(await readArtifactFile(defaultHostConfig().artifactsDir, version, ['assets', ...path].join('/')))
}
