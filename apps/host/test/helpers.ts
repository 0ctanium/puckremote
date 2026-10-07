import { build } from '@poc/cli'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultHostConfig, type HostConfig } from '../src/server/config.ts'
import { IsolateRunner } from '../src/server/isolate-runner.ts'
import type { CtxInput } from '../src/server/render.ts'

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
export const FIXTURES = path.join(import.meta.dirname, 'fixtures')

const cache = new Map<string, Promise<{ outDir: string; bundle: string; manifest: any }>>()

/** Build a developer repo with the real CLI into a temp dir (cached per test process). */
export function buildTheme(dir: string) {
  if (!cache.has(dir)) {
    cache.set(
      dir,
      (async () => {
        const outDir = path.join(os.tmpdir(), `poc-test-${path.basename(dir)}-${process.pid}`)
        const { manifest } = await build({ cwd: dir, outDir, quiet: true })
        return { outDir, manifest, bundle: await readFile(path.join(outDir, 'bundle.js'), 'utf8') }
      })(),
    )
  }
  return cache.get(dir)!
}

export const buildEvil = () => buildTheme(path.join(FIXTURES, 'evil'))
export const buildExample = () => buildTheme(path.join(REPO_ROOT, 'examples', 'theme'))

export function testConfig(overrides: Partial<HostConfig> = {}): HostConfig {
  const base = defaultHostConfig()
  return { ...base, isolate: { ...base.isolate, callTimeoutMs: 150, watchdogMs: 1500 }, ...overrides }
}

export const quietLog = { error() {}, warn() {}, info() {} }

export function newRunner(bundle: string, cfg = testConfig()) {
  return new IsolateRunner(bundle, cfg.isolate, quietLog)
}

export function ctx(overrides: Partial<CtxInput> = {}): CtxInput {
  return {
    isEditing: false,
    locale: 'en',
    nonce: 'n0nce0000000000000000000000000000',
    page: { slug: 'home' },
    site: { name: 'Test' },
    assetBase: '/theme-assets/v1/',
    ...overrides,
  }
}
