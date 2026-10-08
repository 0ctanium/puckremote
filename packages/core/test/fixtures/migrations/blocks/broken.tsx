import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  version: 2,
  migrations: {
    2: () => {
      throw new Error('migration boom')
    },
  },
  fields: { x: { type: 'text' } },
  render: (p) => <p>{p.x}</p>,
})
