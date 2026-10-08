/** Shared tsdown settings for every publishable @puck-remote package (not published itself). */
import { defineConfig, type UserConfig } from 'tsdown'

export function library(entry: Record<string, string>, extra: UserConfig = {}) {
  return defineConfig({
    entry,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    // .js/.d.ts (packages are "type": "module"), matching the exports maps.
    fixedExtension: false,
    // dependencies + peerDependencies stay external (tsdown default); nothing else is bundled in.
    ...extra,
  })
}
