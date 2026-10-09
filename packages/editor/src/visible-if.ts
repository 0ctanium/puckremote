import type { VisibleIf } from '@puck-remote/core'

/** Evaluates the declarative visibleIf grammar. Never evaluates strings. */
export function isVisible(cond: VisibleIf | undefined, props: Record<string, unknown>): boolean {
  if (!cond) return true
  if ('and' in cond) return cond.and.every((c) => isVisible(c, props))
  if ('or' in cond) return cond.or.some((c) => isVisible(c, props))
  const v = props[cond.field] ?? null
  if ('eq' in cond) return v === cond.eq
  if ('in' in cond) return cond.in.includes(v as never)
  if ('not' in cond) return v !== cond.not
  return true
}
