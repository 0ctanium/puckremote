import { defineBlock } from '@poc/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    ;(Object.prototype as any).polluted = 'yes'
    ;(globalThis as any).__leak = 'leaked'
    return <p>polluted</p>
  },
})
