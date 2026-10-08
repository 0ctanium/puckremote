/**
 * Content migrations (D-0068): outdated items are upgraded by the theme's migrations in the
 * sandbox, on both runtimes; the host keeps id, slots and __ keys; failures stay per block.
 */
import { publish } from '@puck-remote/cli'
import { fsArtifactStore } from '@puck-remote/artifacts-fs'
import { fsPageStore } from '@puck-remote/pages-fs'
import { mockCms } from '@puck-remote/source-mock'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCore, devAllowAll } from '../src/index.ts'
import { manifestSchema } from '../src/server/manifest-schema.ts'
import { migratePage } from '../src/server/migrate.ts'
import type { PageData } from '../src/server/page-tree.ts'
import { preparePage } from '../src/server/public-render.ts'
import { inProcessRenderer } from '../src/server/runtime/in-process.ts'
import type { RenderRuntime } from '../src/server/runtime/types.ts'
import { workerPoolRenderer } from '../src/server/runtime/worker-pool.ts'
import { buildMigrations, quietLog, REPO_ROOT, seedPages, testConfig, testHost } from './helpers.ts'

const PAGE: PageData = {
  root: { props: { heading: 'Old root' } },
  content: [
    { type: 'chain', props: { id: 'c1', name: 'Hi', size: 2, content: [{ type: 'plain', props: { id: 'p1', text: 'inside' } }] } },
    { type: 'broken', props: { id: 'b1', x: 'kept' } },
    { type: 'chain', props: { id: 'c2', title: 'Future', size: 1, content: [], __v: 9 } },
    { type: 'plain', props: { id: 'p2', text: 't' } },
  ],
}

const RUNTIMES: [string, (bundle: string) => RenderRuntime][] = [
  ['in-process', (bundle) => inProcessRenderer({ log: quietLog })({ version: 1, bundle, limits: testConfig().isolate })],
  ['worker-pool', (bundle) => workerPoolRenderer({ size: 1, log: quietLog })({ version: 1, bundle, limits: testConfig().isolate })],
]

describe.each(RUNTIMES)('migratePage (%s runtime)', (_name, make) => {
  let runtime: RenderRuntime
  let manifest: any
  beforeAll(async () => {
    const built = await buildMigrations()
    manifest = manifestSchema.parse(built.manifest)
    runtime = make(built.bundle)
  })
  afterAll(() => runtime.dispose())

  it('applies the chain, keeps host-owned keys and slots, isolates failures, leaves newer items alone', async () => {
    const warn = vi.fn()
    const s = await runtime.session()
    try {
      const { data, failed } = await migratePage(PAGE, manifest, async () => s, { warn, error() {} })
      expect(data.root.props).toEqual({ title: 'Old root', __v: 2 })
      expect(data.content[0].props).toEqual({
        id: 'c1',
        title: 'Hi',
        size: 20,
        content: [{ type: 'plain', props: { id: 'p1', text: 'inside', __v: 1 } }],
        __v: 3,
      })
      expect(data.content[1].props).toEqual({ id: 'b1', x: 'kept', __v: 1 })
      expect([...failed]).toEqual([['b1', { block: 'broken', error: expect.stringMatching(/migration boom/) }]])
      expect(data.content[2].props).toEqual(PAGE.content[2].props)
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/chain#c2 was saved with version 9/))
      expect(data.content[3].props).toEqual({ id: 'p2', text: 't', __v: 1 })
    } finally {
      s.release()
    }
  })

  it('opens no session when nothing is outdated', async () => {
    const session = vi.fn()
    const current: PageData = { root: { props: { title: 'x', __v: 2 } }, content: [{ type: 'plain', props: { id: 'p', text: 'a' } }] }
    await migratePage(current, manifest, session)
    expect(session).not.toHaveBeenCalled()
  })
})

describe('migrations in the page lifecycle', () => {
  it('public render: migrated output; a failed migration fails only its block (no data fetched)', async () => {
    const h = await testHost({ theme: 'migrations', pages: { home: PAGE } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const page = (await preparePage(h.host, 'home', {}))!
      expect(page.rendered.root.html).toContain('data-title="Old root"')
      expect(page.rendered.c1.html).toContain('Hi<!-- -->:<!-- -->20')
      expect(page.rendered.p1.html).toContain('inside')
      expect(page.rendered.b1).toMatchObject({ ok: false, error: 'migration', html: '' })
      expect(page.rendered.c2.html).toContain('Future<!-- -->:<!-- -->1')
      expect(page.stats.failures).toBe(1)
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/block broken#b1 failed \(migration\)/))
      // Not persisted: the stored page is unchanged.
      expect((await h.host.config.pages.getPublished('home'))!.data).toEqual(PAGE)
    } finally {
      await h.close()
    }
  })

  it('editor: loads migrated data with errors listed; saving persists it and stamps new items', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const dir = await mkdtemp(path.join(os.tmpdir(), 'puck-remote-migrations-'))
    await publish({ distDir: (await buildMigrations()).outDir, artifacts: path.join(dir, 'artifacts'), quiet: true })
    const pages = fsPageStore({ dir: path.join(dir, 'pages') })
    await seedPages(pages, { home: PAGE })
    const core = createCore({
      id: `migrations-${process.pid}`,
      artifacts: fsArtifactStore({ dir: path.join(dir, 'artifacts') }),
      source: mockCms({ dataFile: path.join(REPO_ROOT, 'data', 'cms.json') }),
      pages,
      auth: devAllowAll(),
      renderer: inProcessRenderer({ log: quietLog }),
    })
    try {
      const editor = await core.loadEditor('home', new Request('http://host.test/editor'))
      expect(editor.migrationErrors).toEqual(['broken'])
      const data = editor.initialData as unknown as PageData
      expect(data.content[0].props).toMatchObject({ title: 'Hi', size: 20, __v: 3 })
      expect(data.content[1].props).toMatchObject({ x: 'kept', __v: 1 }) // explicit: never stamped as current

      // The editor adds a block (no __v) and saves.
      const edited = { ...data, content: [...data.content, { type: 'chain', props: { id: 'new', title: 'New', size: 1, content: [] } }] }
      const res = await core.handleApi(
        new Request('http://host.test/api/pages/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-puck-remote': '1' },
          body: JSON.stringify({ slug: 'home', data: edited, baseRevision: editor.page!.draftRevision }),
        }),
      )
      expect(res.status).toBe(200)
      const { meta } = await res.json()
      const stored = JSON.parse(await readFile(path.join(dir, 'pages', 'home', 'revisions', `${meta.draftRevision}.json`), 'utf8')).data as PageData
      expect(stored.content.map((i) => i.props.__v)).toEqual([3, 1, 9, 1, 3])
      expect(stored.root.props).toMatchObject({ title: 'Old root', __v: 2 })
    } finally {
      ;(await core.host()).store.close()
    }
  })

  it('artifacts built for SDK major 1 are rejected', async () => {
    const { manifest } = await buildMigrations()
    const r = manifestSchema.safeParse({ ...manifest, sdkMajor: 1 })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0].message).toMatch(/incompatible SDK major version/)
  })
})
