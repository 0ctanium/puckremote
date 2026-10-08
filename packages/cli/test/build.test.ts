/**
 * Test 21: the build rejects anything that is not declarative JSON (plus a happy path).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build, BuildError } from '../src/index.ts'

// Fixtures must live under this package so `@puck-remote/sdk` and `react` resolve.
const ROOT = path.join(import.meta.dirname, '.fixtures')
const made: string[] = []
afterAll(() => Promise.all(made.map((d) => rm(d, { recursive: true, force: true }))))

async function theme(files: Record<string, string>) {
  await mkdir(ROOT, { recursive: true })
  const dir = await mkdtemp(path.join(ROOT, 't-'))
  made.push(dir)
  for (const [f, src] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, f)), { recursive: true })
    await writeFile(path.join(dir, f), src)
  }
  return dir
}

const block = (body: string) => `import { defineBlock, find, Slot } from '@puck-remote/sdk'\nexport default ${body}\n`
const ok = `defineBlock({ fields: { title: { type: 'text' } }, render: (p) => <h1>{p.title}</h1> })`

async function expectBuildError(files: Record<string, string>, pattern: RegExp) {
  const dir = await theme(files)
  const err = await build({ cwd: dir, quiet: true }).catch((e) => e)
  expect(err).toBeInstanceOf(BuildError)
  expect(String(err.message)).toMatch(pattern)
}

describe('21. build validation', () => {
  it('builds a valid theme and computes analysis', async () => {
    const dir = await theme({
      'blocks/a.tsx': block(`defineBlock({
        fields: { n: { type: 'number' }, s: { type: 'slot' } },
        data: { q: find('posts', { limit: { $prop: 'n' }, where: { title: { contains: { $query: 'q' } } } }) },
        render: (p) => <div><Slot name="s" /></div>,
      })`),
    })
    const { manifest } = await build({ cwd: dir, quiet: true })
    expect(manifest.blocks.a).toMatchObject({ propRefs: { q: ['n'] }, usesRequestParams: true, slots: ['s'] })
    expect(Object.keys(manifest.files)).toContain('bundle.js')
  })

  it('rejects function-valued field options', async () => {
    await expectBuildError(
      { 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'array', arrayFields: { x: { type: 'text' } }, getItemSummary: (i) => i.x } }, render: () => null } as any)`) },
      /function-valued field options/,
    )
    await expectBuildError(
      { 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'select', options: [{ label: 'a', value: () => 1 }] } }, render: () => null } as any)`) },
      /options\[0\]/,
    )
  })

  it('rejects external and custom fields', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'external', fetchList: async () => [] } }, render: () => null } as any)`) }, /"external" is not supported/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'custom', render: () => null } }, render: () => null } as any)`) }, /"custom" is not supported/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { t: { type: 'richtext' } }, render: () => null } as any)`) }, /unsupported field type/)
  })

  it('rejects permissions, resolvePermissions, resolveFields and resolveData', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, permissions: { delete: false }, render: () => null } as any)`) }, /"permissions" is not supported/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, resolvePermissions: () => ({}), render: () => null } as any)`) }, /"resolvePermissions"/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, resolveFields: () => ({}), render: () => null } as any)`) }, /use declarative visibleIf/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, resolveData: async () => ({}), render: () => null } as any)`) }, /declare queries in `data`/)
  })

  it('rejects non-serializable metadata', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { when: new Date() }, render: () => null } as any)`) }, /non-plain object \(Date\)/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { m: new Map() }, render: () => null } as any)`) }, /non-plain object \(Map\)/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { n: NaN }, render: () => null } as any)`) }, /non-finite/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, defaultProps: { f: () => 1 }, render: () => null } as any)`) }, /function values are not allowed/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, label: Symbol('x'), render: () => null } as any)`) }, /label: must be a string/)
  })

  it('rejects expression-string visibleIf, unknown refs and secrets outside headers', async () => {
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { a: { type: 'text', visibleIf: 'b === 1' } }, render: () => null } as any)`) }, /visibleIf must be an object/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: { a: { type: 'text' } }, data: { q: find('posts', { limit: { $prop: 'nope' } }) }, render: () => null } as any)`) }, /\$prop "nope" is not a field/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, data: { q: find('posts', { where: { t: { equals: { $secret: 'K' } } } }) }, render: () => null } as any)`) }, /\$secret is only allowed/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, data: { q: find('posts', { where: { t: { regex: '.*' } } }) }, render: () => null } as any)`) }, /unsupported operator/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ fields: {}, data: { q: { source: 'sql', query: 'select 1' } }, render: () => null } as any)`) }, /query must be built with/)
  })

  it('a valid block next to an invalid one still fails the whole build', async () => {
    await expectBuildError({ 'blocks/good.tsx': block(ok), 'blocks/bad.tsx': block(`defineBlock({ fields: { x: { type: 'external' } }, render: () => null } as any)`) }, /blocks\/bad/)
  })
})

describe('content migrations: versions and baseline', () => {
  const v = (version: number, fields: string, migrations = '') =>
    block(`defineBlock({ version: ${version}, ${migrations ? `migrations: { ${migrations} },` : ''} fields: { ${fields} }, render: () => null })`)
  const step = (n: number) => `${n}: (p) => p`

  it('requires every migration step and rejects extra or invalid ones', async () => {
    await expectBuildError({ 'blocks/a.tsx': v(3, `t: { type: 'text' }`, step(2)) }, /migrations\.3: missing migration from version 2 to 3/)
    await expectBuildError({ 'blocks/a.tsx': v(2, `t: { type: 'text' }`, `${step(2)}, ${step(3)}`) }, /migrations\.3: unexpected key/)
    await expectBuildError({ 'blocks/a.tsx': v(1, `t: { type: 'text' }`, step(1)) }, /migrations\.1: unexpected key/)
    await expectBuildError({ 'blocks/a.tsx': v(0, `t: { type: 'text' }`) }, /version: must be an integer >= 1/)
    await expectBuildError({ 'blocks/a.tsx': block(`defineBlock({ version: 2, migrations: { 2: 'x' }, fields: {}, render: () => null } as any)`) }, /missing migration from version 1 to 2/)
    const { manifest } = await build({ cwd: await theme({ 'blocks/a.tsx': v(3, `t: { type: 'text' }`, `${step(2)}, ${step(3)}`), 'blocks/b.tsx': block(ok) }), quiet: true })
    expect(manifest.blocks.a.version).toBe(3)
    expect(manifest.blocks.b.version).toBe(1)
  })

  it('--baseline: changed fields need a version bump; versions never go down; labels are free', async () => {
    const base = await build({ cwd: await theme({ 'blocks/a.tsx': v(1, `t: { type: 'text', label: 'Title' }, s: { type: 'select', options: [{ label: 'A', value: 'a' }] }`) }), quiet: true })
    const baseline = path.join(base.outDir, 'manifest.json')
    const attempt = async (src: string) => build({ cwd: await theme({ 'blocks/a.tsx': src }), quiet: true, baseline }).then(() => null, (e) => e)

    // Label-only change: fine.
    expect(await attempt(v(1, `t: { type: 'text', label: 'Heading' }, s: { type: 'select', options: [{ label: 'Option A', value: 'a' }] }`))).toBeNull()
    // Renamed field, changed type, changed option value: need a bump.
    for (const fields of [`title: { type: 'text' }, s: { type: 'select', options: [{ label: 'A', value: 'a' }] }`, `t: { type: 'textarea' }, s: { type: 'select', options: [{ label: 'A', value: 'a' }] }`, `t: { type: 'text' }, s: { type: 'select', options: [{ label: 'A', value: 'b' }] }`]) {
      const err = await attempt(v(1, fields))
      expect(err).toBeInstanceOf(BuildError)
      expect(err.message).toBe('block "a": fields changed without a version bump (still v1); bump "version" and add a migration')
    }
    expect(await attempt(v(2, `title: { type: 'text' }`, step(2)))).toBeNull()
    const down = await build({ cwd: await theme({ 'blocks/a.tsx': v(2, `title: { type: 'text' }`, step(2)) }), quiet: true })
    const err = await build({ cwd: await theme({ 'blocks/a.tsx': v(1, `title: { type: 'text' }`) }), quiet: true, baseline: path.join(down.outDir, 'manifest.json') }).catch((e) => e)
    expect(err.message).toBe('block "a": version went down (2 → 1)')
  })

  it('publish compares with the active artifact and refuses unless forced', async () => {
    const { publish } = await import('../src/index.ts')
    const artifacts = path.join(await theme({}), 'artifacts')
    const one = await build({ cwd: await theme({ 'blocks/a.tsx': v(1, `t: { type: 'text' }`) }), quiet: true })
    await publish({ distDir: one.outDir, artifacts, quiet: true })
    const changed = await build({ cwd: await theme({ 'blocks/a.tsx': v(1, `u: { type: 'text' }`) }), quiet: true })
    await expect(publish({ distDir: changed.outDir, artifacts, quiet: true })).rejects.toThrow(
      'block "a": fields changed without a version bump (still v1); bump "version" and add a migration (compared with the active artifact v1; use --force to publish anyway)',
    )
    expect((await publish({ distDir: changed.outDir, artifacts, quiet: true, force: true })).version).toBe(2)
    const bumped = await build({ cwd: await theme({ 'blocks/a.tsx': v(2, `w: { type: 'text' }`, step(2)) }), quiet: true })
    expect((await publish({ distDir: bumped.outDir, artifacts, quiet: true })).version).toBe(3)
  })
})
