/** The main (live) theme. Edge-safe: no Node imports. */
import type { ArtifactStore, Theme } from '@puck-remote/sdk/host'

export async function mainTheme(store: ArtifactStore): Promise<Theme | null> {
  return (await store.readThemes()).themes.find((t) => t.role === 'main') ?? null
}
