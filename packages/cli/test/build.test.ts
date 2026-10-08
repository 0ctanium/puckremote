/**
 * Test 21: the build rejects anything that is not declarative JSON (plus a happy path).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BROWSER_EXTERNALS, build, BuildError, publish, pull } from '../src/index.ts'

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

describe('pages and the browser bundle', () => {
  const page = (content: unknown[]) => JSON.stringify({ root: { props: {} }, content })
  const slotted = block(`defineBlock({ fields: { title: { type: 'text' }, s: { type: 'slot' } }, render: (p) => <div>{p.title}<Slot name="s" /></div> })`)

  it('ships theme pages in the artifact, listed in manifest.files', async () => {
    const dir = await theme({
      'blocks/a.tsx': slotted,
      'pages/home.json': page([{ type: 'a', props: { id: '1', s: [{ type: 'a', props: { id: '2' } }] } }]),
      'pages/blog/post-1.json': page([]),
    })
    const { manifest, outDir } = await build({ cwd: dir, quiet: true })
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['pages/home.json', 'pages/blog/post-1.json', 'bundle.browser.js']))
    expect(JSON.parse(await readFile(path.join(outDir, 'pages', 'home.json'), 'utf8')).content[0].type).toBe('a')
  })

  it('fails on a page using a block the theme does not have (also inside slots)', async () => {
    await expectBuildError({ 'blocks/a.tsx': slotted, 'pages/home.json': page([{ type: 'gone', props: { id: '1' } }]) }, /pages\/home.json content\[0\]: unknown block "gone"/)
    await expectBuildError(
      { 'blocks/a.tsx': slotted, 'pages/home.json': page([{ type: 'a', props: { id: '1', s: [{ type: 'gone', props: {} }] } }]) },
      /content\[0\]\.props\.s\[0\]: unknown block "gone"/,
    )
  })

  it('fails on invalid page files', async () => {
    await expectBuildError({ 'blocks/a.tsx': slotted, 'pages/Home.json': page([]) }, /pages\/<slug>\.json/)
    await expectBuildError({ 'blocks/a.tsx': slotted, 'pages/home.json': '{ nope' }, /invalid JSON/)
    await expectBuildError({ 'blocks/a.tsx': slotted, 'pages/home.json': '{"content": []}' }, /must be Puck data/)
  })

  it('the browser bundle is ESM that leaves React and the SDK to the editor', async () => {
    const dir = await theme({ 'blocks/a.tsx': slotted })
    const { outDir } = await build({ cwd: dir, quiet: true })
    const src = await readFile(path.join(outDir, 'bundle.browser.js'), 'utf8')
    const imports = [...src.matchAll(/from\s*"([^"]+)"/g)].map((m) => m[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const i of imports) expect(BROWSER_EXTERNALS as readonly string[]).toContain(i)
    expect(src).toMatch(/export\s*\{[^}]*as default/)
  })
})

describe('pull', () => {
  it('downloads the current artifact pages into the theme repo', async () => {
    const dir = await theme({ 'blocks/a.tsx': simpleBlock(), 'pages/home.json': JSON.stringify({ root: { props: {} }, content: [] }) })
    const { outDir } = await build({ cwd: dir, quiet: true })
    const store = path.join(dir, '.artifacts')
    const { id } = await publish({ distDir: outDir, artifacts: store, quiet: true })
    const target = await theme({})
    expect(await pull({ cwd: target, artifacts: store, quiet: true })).toEqual({ id, pages: ['pages/home.json'] })
    expect(JSON.parse(await readFile(path.join(target, 'pages', 'home.json'), 'utf8'))).toEqual({ root: { props: {} }, content: [] })
    await expect(pull({ cwd: target, artifacts: path.join(dir, '.empty'), quiet: true })).rejects.toThrow(/nothing published/)
  })
})

function simpleBlock() {
  return block(`defineBlock({ fields: { title: { type: 'text' } }, render: (p) => <div>{p.title}</div> })`)
}
