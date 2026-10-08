import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  fields: { text: { type: 'text' } },
  render: (p) => <p className="plain">{p.text}</p>,
})
