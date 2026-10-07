import { defineBlock } from '@puck-remote/sdk'

/** Reports what the sandbox exposes. */
export default defineBlock({
  fields: {},
  render: () => {
    const g = globalThis as any
    let env = 'unavailable'
    try {
      env = typeof g.process?.env
    } catch {}
    const report = {
      fetch: typeof g.fetch,
      process: typeof g.process,
      require: typeof g.require,
      env,
      setTimeout: typeof g.setTimeout,
      setInterval: typeof g.setInterval,
      queueMicrotask: typeof g.queueMicrotask,
      XMLHttpRequest: typeof g.XMLHttpRequest,
      WebSocket: typeof g.WebSocket,
      importScripts: typeof g.importScripts,
      polluted: ({} as any).polluted ?? null,
      leakedGlobal: g.__leak ?? null,
    }
    return <pre id="probe">{JSON.stringify(report)}</pre>
  },
})
