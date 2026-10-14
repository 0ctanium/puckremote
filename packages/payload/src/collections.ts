/**
 * The collections the Payload artifact store keeps themes in (added to the Payload config by the
 * plugin). Only the store reads and writes them, with `overrideAccess`: no REST, GraphQL or admin
 * access.
 */
import type { CollectionConfig } from 'payload'

export const THEME_LISTS = 'puck-remote-theme-lists'
export const THEME_FILES = 'puck-remote-theme-files'

const denied = { read: () => false, create: () => false, update: () => false, delete: () => false }

export function artifactCollections(): CollectionConfig[] {
  return [
    {
      slug: THEME_LISTS,
      admin: { hidden: true },
      access: denied,
      // Append-only revisions of the theme list: the unique seq makes a concurrent write fail.
      fields: [
        { name: 'seq', type: 'number', required: true, unique: true, index: true },
        { name: 'themes', type: 'json', required: true },
      ],
    },
    {
      slug: THEME_FILES,
      admin: { hidden: true },
      access: denied,
      // A theme's current files, one row each (base64 bytes).
      fields: [
        { name: 'theme', type: 'text', required: true, index: true },
        { name: 'path', type: 'text', required: true },
        // No Payload text-length check (defaultMaxTextLength): the host validated and size-limited the files.
        { name: 'data', type: 'textarea', required: true, validate: () => true },
        { name: 'size', type: 'number', required: true },
      ],
      indexes: [{ fields: ['theme', 'path'], unique: true }],
    },
  ]
}
