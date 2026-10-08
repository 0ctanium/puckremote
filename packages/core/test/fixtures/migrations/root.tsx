import { defineRoot, Slot } from '@puck-remote/sdk'

// v2 renamed `heading` to `title`.
export default defineRoot({
  version: 2,
  migrations: { 2: ({ heading, ...p }) => ({ ...p, title: heading }) },
  fields: { title: { type: 'text' } },
  render: (p) => (
    <div id="root" data-title={p.title}>
      <Slot name="children" />
    </div>
  ),
})
