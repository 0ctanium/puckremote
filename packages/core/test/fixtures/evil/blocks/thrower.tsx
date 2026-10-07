import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    throw new Error('boom')
  },
})
