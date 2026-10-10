/**
 * Templates: app root fields merged with the theme's, params reaching data refs, and the
 * artifact layout (templates/<name>.json; pages/ is refused).
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConfigError, resolveConfig } from '../src/index.ts'
import { manifestSchema, type Manifest } from '../src/server/manifest-schema.ts'
import { substitute } from '../src/server/query/params.ts'
import { mergeRoot, rootOf } from '../src/server/root.ts'
import { checkParams, TemplateError } from '../src/server/templates.ts'
import { buildExample } from './helpers.ts'

const themeRoot = (fields: NonNullable<Manifest['root']>['fields'], defaultProps: Record<string, unknown>) =>
  ({ label: 'root', fields, defaultProps, data: {}, propRefs: {}, usesRequestParams: false, slots: [] }) as NonNullable<Manifest['root']>

describe('root fields', () => {
  const app = {
    fields: { title: { type: 'text' as const }, theme: { type: 'text' as const, label: 'App theme' } },
    defaultProps: { title: 'Untitled', theme: 'app' },
  }
  const theme = themeRoot({ theme: { type: 'radio', options: [{ label: 'Light', value: 'light' }] }, tone: { type: 'text' } }, { theme: 'light', tone: 'calm' })

  it('puts the app fields first; the app wins a name collision, defaults included', () => {
    const { fields, defaultProps, shadowed } = mergeRoot(app, theme)
    expect(Object.keys(fields)).toEqual(['title', 'theme', 'tone'])
    expect(fields.theme).toEqual(app.fields.theme)
    expect(defaultProps).toEqual({ title: 'Untitled', theme: 'app', tone: 'calm' })
    expect(shadowed).toEqual(['theme'])
  })

  it('works without a theme root, and without app fields', () => {
    expect(mergeRoot(app, null)).toMatchObject({ fields: app.fields, shadowed: [] })
    expect(mergeRoot({ fields: {}, defaultProps: {} }, theme)).toMatchObject({ fields: theme.fields, defaultProps: theme.defaultProps })
  })

  it('warns once per artifact about a shadowed theme field', () => {
    const log = { warn: vi.fn() }
    rootOf(app, 'a1', { root: theme }, log)
    rootOf(app, 'a1', { root: theme }, log)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('[puck-remote] root field "theme" is defined by the app and the theme; the app\'s is used')
    rootOf(app, 'a2', { root: theme }, log)
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('config.root is validated like manifest fields', () => {
    const base = { artifacts: {} as never, source: {} as never }
    expect(resolveConfig(base).root).toEqual({ fields: {}, defaultProps: {} })
    expect(() => resolveConfig({ ...base, root: { fields: { x: { type: 'nope' } } as never } })).toThrow(ConfigError)
  })
})

describe('params', () => {
  const env = { props: {}, template: { name: 'product', locale: 'fr' }, params: { handle: 'red-shoe' }, site: { name: 'S', locale: 'en' }, query: {} }

  it('$params and $template refs resolve; a missing param is null', () => {
    expect(substitute({ a: { $params: 'handle' }, b: { $params: 'nope' }, c: { $template: 'name' }, d: { $template: 'locale' } }, env)).toEqual({
      a: 'red-shoe',
      b: null,
      c: 'product',
      d: 'fr',
    })
  })

  it('accepts at most 32 string values of up to 1 KB', () => {
    expect(checkParams(undefined)).toEqual({})
    expect(checkParams({ handle: 'x' })).toEqual({ handle: 'x' })
    expect(() => checkParams({ n: 1 })).toThrow(TemplateError)
    expect(() => checkParams({ s: 'x'.repeat(1025) })).toThrow(TemplateError)
    expect(() => checkParams(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 'v'])))).toThrow(TemplateError)
    expect(() => checkParams(['x'])).toThrow(TemplateError)
  })
})

describe('artifact layout', () => {
  it('lists templates/<name>.json and refuses pages/', async () => {
    const { outDir } = await buildExample()
    const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['templates/home.json']))
    expect(manifestSchema.safeParse(manifest).success).toBe(true)
    const legacy = { ...manifest, files: { ...manifest.files, 'pages/home.json': 'a'.repeat(64) } }
    const r = manifestSchema.safeParse(legacy)
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('pages/ is no longer supported')
  })
})
