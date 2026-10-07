import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    const hog: number[][] = []
    // ~32 MB per iteration: blows the 64 MB limit within a few allocations.
    for (;;) hog.push(new Array(4_000_000).fill(hog.length + 0.5))
  },
})
