import { defineBlock } from '@poc/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    const hog: number[][] = []
    // ~8 MB per iteration: blows the 64 MB limit long before the CPU timeout.
    for (;;) hog.push(new Array(1_000_000).fill(hog.length + 0.5))
  },
})
