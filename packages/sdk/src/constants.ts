// Shared, data-only contract between the SDK, the CLI and the host.
// The host re-declares these in its zod schema; it never imports developer code.

export const SDK_MAJOR = 3

export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'radio',
  'array',
  'object',
  'slot',
  'host:color',
  'host:media',
  'host:link',
] as const

export const WHERE_OPERATORS = ['equals', 'in', 'contains', 'gt', 'lt'] as const

/** Keys a block/root definition may hold functions in. Everything else must be JSON. */
export const FUNCTION_KEYS = ['render'] as const
export const ADAPTER_FUNCTION_KEYS = ['toRequest', 'fromResponse'] as const

/** Puck options we deliberately do not support. Their presence fails the build. */
export const FORBIDDEN_DEFINITION_KEYS = [
  'permissions',
  'resolvePermissions',
  'resolveFields',
  'resolveData',
  'inline',
] as const

/** Caps for the isolate's only side channel (ctx.head / ctx.assets). */
export const EFFECT_LIMITS = {
  maxEffects: 64,
  maxStringLength: 2048,
} as const

export const PAGE_REF_KEYS = ['slug', 'locale'] as const
export const SITE_REF_KEYS = ['locale', 'name'] as const
