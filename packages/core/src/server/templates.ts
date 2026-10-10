/**
 * Templates live inside the theme artifact (templates/<name>.json, listed in manifest.files), like a
 * Shopify theme's templates. Reading verifies the template's hash; writing produces a new artifact
 * (same files, new template, rewritten manifest) and never moves the pointer.
 */
import { createHash } from 'node:crypto'
import type { ArtifactId, ArtifactStore } from '@puck-remote/sdk/host'
import { z } from 'zod'
import { isArtifactId } from './artifact-loader.ts'
import { templatePath, templateNames, type Manifest } from './manifest-schema.ts'
import { mapItems, RESERVED_DATA_PROP, restoreMissing, type TemplateData, type PuckItem } from './page-tree.ts'

// Template names: lowercase segments, up to five levels (e.g. "home", "blog/post").
const TEMPLATE_NAME = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/

/** Template JSON size cap. */
export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024

const isTemplateName = (name: string) => TEMPLATE_NAME.test(name)

const templateSchema = z.object({
  root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
  content: z.array(z.unknown()),
  zones: z.record(z.string(), z.array(z.unknown())).optional(),
})

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

/** A template of an artifact, hash-verified and validated, or null when the artifact has no such template. */
export async function readTemplate(store: ArtifactStore, id: ArtifactId, manifest: Pick<Manifest, 'files'>, name: string): Promise<TemplateData | null> {
  const file = templatePath(name)
  const expected = Object.hasOwn(manifest.files, file) ? manifest.files[file] : null
  if (!expected) return null
  const bytes = await store.readFile(id, file)
  if (!bytes) throw new TemplateError(`template ${name} is missing from artifact ${id}`)
  if (sha256(bytes) !== expected) throw new TemplateError(`template ${name}: hash mismatch in artifact ${id}`)
  return templateSchema.parse(JSON.parse(decoder.decode(bytes))) as TemplateData
}

export { templateNames }

const stripItem = (item: PuckItem): PuckItem => {
  const { [RESERVED_DATA_PROP]: _drop, ...props } = item.props
  const out: PuckItem = { ...item, props }
  if (item.readOnly) {
    const { [RESERVED_DATA_PROP]: _ro, ...readOnly } = item.readOnly
    if (Object.keys(readOnly).length) out.readOnly = readOnly
    else delete out.readOnly
  }
  return out
}

/** Remove everything resolveData produced (and any reserved host keys) before persisting. */
export function stripResolved(data: TemplateData): TemplateData {
  const mapped = mapItems(data, null, stripItem)
  const rootProps = { ...(data.root?.props ?? {}) }
  delete rootProps[RESERVED_DATA_PROP]
  const root: TemplateData['root'] = { ...data.root, props: rootProps }
  if (root.readOnly) {
    const { [RESERVED_DATA_PROP]: _ro, ...ro } = root.readOnly
    if (Object.keys(ro).length) root.readOnly = ro
    else delete root.readOnly
  }
  return { ...mapped, root }
}

/** Validate and clean editor data for storage (resolved data stripped, missing blocks restored). Throws on invalid data. */
export function cleanTemplate(data: unknown): TemplateData {
  return stripResolved(restoreMissing(templateSchema.parse(data) as TemplateData))
}

/**
 * Write a template into a copy of the `base` artifact and return the new artifact's id. The pointer
 * is not moved: making the result current is the caller's decision (a "publish" plugin).
 */
export async function writeTemplate(store: ArtifactStore, base: ArtifactId, name: string, data: unknown): Promise<{ id: ArtifactId }> {
  if (!isTemplateName(name)) throw new TemplateError(`invalid template name ${name}`)
  if (!isArtifactId(base)) throw new TemplateError('invalid base artifact id')
  let template: TemplateData
  try {
    template = cleanTemplate(data)
  } catch {
    throw new TemplateError('invalid template data')
  }
  const templateBytes = encoder.encode(JSON.stringify(template, null, 2) + '\n')
  if (templateBytes.byteLength > MAX_TEMPLATE_BYTES) throw new TemplateError(`template ${name} is larger than ${MAX_TEMPLATE_BYTES} bytes`)

  // The raw manifest (not the loader's parsed copy, which carries recomputed analysis).
  const manifestBytes = await store.readFile(base, 'manifest.json')
  if (!manifestBytes) throw new TemplateError(`artifact ${base} does not exist`)
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as { files: Record<string, string> }
  const files: Record<string, Uint8Array> = {}
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const bytes = await store.readFile(base, rel)
    if (!bytes || sha256(bytes) !== expected) throw new TemplateError(`artifact ${base}: ${rel} is missing or corrupted`)
    files[rel] = bytes
  }
  const file = templatePath(name)
  files[file] = templateBytes
  manifest.files = Object.fromEntries(Object.entries({ ...manifest.files, [file]: sha256(templateBytes) }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2))
  return { id: await store.writeArtifact(files) }
}

const MAX_PARAMS = 32
const MAX_PARAM_LENGTH = 1024

/** Params an app passes to a template: at most 32 string values of up to 1 KB each. */
export function checkParams(params: unknown): Record<string, string> {
  if (params === undefined) return {}
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TemplateError('params must be an object of strings')
  const entries = Object.entries(params)
  if (entries.length > MAX_PARAMS) throw new TemplateError(`params: more than ${MAX_PARAMS} keys`)
  for (const [k, v] of entries) {
    if (typeof v !== 'string') throw new TemplateError(`params.${k} must be a string`)
    if (v.length > MAX_PARAM_LENGTH) throw new TemplateError(`params.${k} is longer than ${MAX_PARAM_LENGTH} characters`)
  }
  return Object.fromEntries(entries) as Record<string, string>
}
