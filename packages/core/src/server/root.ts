/**
 * Root fields: the app's (config.root) merged with the theme's (manifest.root). App fields come
 * first and win on a name collision; the theme's field is then ignored with a warning, once per
 * artifact.
 */
import type { AppRoot } from './config.ts'
import type { FieldSpec, Manifest } from './manifest-schema.ts'

export interface MergedRoot {
  fields: Record<string, FieldSpec>
  defaultProps: Record<string, unknown>
}

export function mergeRoot(app: AppRoot, theme: Manifest['root']): MergedRoot & { shadowed: string[] } {
  const fields: Record<string, FieldSpec> = { ...app.fields }
  const defaultProps: Record<string, unknown> = { ...app.defaultProps }
  const shadowed: string[] = []
  for (const [name, field] of Object.entries(theme?.fields ?? {})) {
    if (Object.hasOwn(app.fields, name)) {
      shadowed.push(name)
      continue
    }
    fields[name] = field
    if (theme && Object.hasOwn(theme.defaultProps, name)) defaultProps[name] = theme.defaultProps[name]
  }
  return { fields, defaultProps, shadowed }
}

const warned = new WeakMap<AppRoot, Set<string>>()

/** The merged root of an artifact; logs the shadowed theme fields the first time per artifact. */
export function rootOf(app: AppRoot, artifact: string, manifest: Pick<Manifest, 'root'>, log: Pick<Console, 'warn'> = console): MergedRoot {
  const { shadowed, ...root } = mergeRoot(app, manifest.root)
  const seen = warned.get(app) ?? new Set<string>()
  warned.set(app, seen)
  if (shadowed.length && !seen.has(artifact)) {
    seen.add(artifact)
    for (const name of shadowed) log.warn(`[puck-remote] root field "${name}" is defined by the app and the theme; the app's is used`)
  }
  return root
}
