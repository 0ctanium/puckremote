import { defineBlock, Slot } from '@puck-remote/sdk'

// v2 renamed `name` to `title`; v3 multiplies `size` by 10 and tries to touch host-owned keys.
export default defineBlock({
  version: 3,
  migrations: {
    2: ({ name, ...p }) => ({ ...p, title: name }),
    3: (p) => ({ ...p, size: Number(p.size ?? 1) * 10, id: 'hijacked', content: [], __v: 99, __data: 'x' }),
  },
  fields: { title: { type: 'text' }, size: { type: 'number' }, content: { type: 'slot' } },
  render: (p) => (
    <section>
      <h2>
        {p.title}:{p.size}
      </h2>
      <Slot name="content" />
    </section>
  ),
})
