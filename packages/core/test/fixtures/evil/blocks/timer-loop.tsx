import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    const g = globalThis as any
    let scheduled = 'no-timers'
    try {
      const tick = () => g.setTimeout(tick, 0)
      tick()
      scheduled = 'scheduled'
    } catch (e) {
      scheduled = 'threw:' + (e as Error).name
    }
    // Promise-based "sleep" can never resolve without timers; the async fn just stays pending.
    void new Promise((r) => g.setTimeout?.(r, 10_000))
    return <p id="timer">{scheduled}</p>
  },
})
