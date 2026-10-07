import { defineBlock } from '@poc/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    throw new Error('boom')
  },
})
