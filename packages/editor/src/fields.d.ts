/** Manifest field specs → Puck fields (editor). */
import type { Field as PuckField, Fields as PuckFields } from '@puckeditor/core';
import type { FieldSpec } from '@puck-remote/core';
export declare function mapField(f: FieldSpec, name: string): PuckField;
export declare function mapFields(fields: Record<string, FieldSpec>): PuckFields;
