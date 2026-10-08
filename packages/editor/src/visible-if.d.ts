import type { VisibleIf } from '@puck-remote/core';
/** Evaluates the declarative visibleIf grammar. Never evaluates strings. */
export declare function isVisible(cond: VisibleIf | undefined, props: Record<string, unknown>): boolean;
