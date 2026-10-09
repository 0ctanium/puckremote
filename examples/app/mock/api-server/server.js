// Tiny external API stand-in for the events adapter, http() blocks and SSRF tests.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const API_KEY = process.env.EVENTS_API_KEY ?? 'dev-events-key-7f3a9c'

const EVENTS = [
  { uid: 'e1', name: 'Puck meetup', starts_at: '2026-11-03T18:00:00Z', location: { city: 'paris' } },
  { uid: 'e2', name: 'Sandboxing night', starts_at: '2026-11-10T19:00:00Z', location: { city: 'lyon' } },
  { uid: 'e3', name: 'React server day', starts_at: '2026-11-21T09:00:00Z', location: { city: 'paris' } },
  { uid: 'e4', name: 'V8 internals', starts_at: '2026-12-02T18:30:00Z', location: { city: 'lyon' } },
  { uid: 'e5', name: 'Year-end demo', starts_at: '2026-12-15T17:00:00Z', location: { city: 'paris' } },
]

/** @param {{ port?: number, host?: string }} [opts] */
export function startMockApi({ port = 0, host = 'localhost' } = {}) {
  const hits = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    hits.push({ path: url.pathname, search: url.search, headers: { ...req.headers } })
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const self = `http://${req.headers.host}`
    switch (url.pathname) {
      case '/v1/events': {
        if (req.headers['x-api-key'] !== API_KEY) return json(401, { error: 'unauthorized' })
        const city = url.searchParams.get('city')
        const limit = Number(url.searchParams.get('limit') ?? 5)
        return json(200, { items: EVENTS.filter((e) => !city || e.location.city === city).slice(0, limit) })
      }
      case '/v1/public':
        return json(200, { hello: 'world', at: url.searchParams.get('at') })
      case '/v1/redirect-same':
        res.writeHead(302, { location: '/v1/public?at=redirected' })
        return res.end()
      case '/v1/redirect-other-origin':
        res.writeHead(302, { location: 'https://example.com/steal' })
        return res.end()
      case '/v1/redirect-private':
        res.writeHead(302, { location: `http://127.0.0.1:${server.address().port}/v1/public` })
        return res.end()
      case '/v1/redirect-loop':
        res.writeHead(302, { location: '/v1/redirect-loop' })
        return res.end()
      case '/v1/big':
        return json(200, { blob: 'b'.repeat(Number(url.searchParams.get('size') ?? 1_000_000)) })
      case '/v1/slow':
        return setTimeout(() => json(200, { slow: true }), Number(url.searchParams.get('ms') ?? 5000))
      case '/v1/echo-headers':
        return json(200, { headers: Object.keys(req.headers).sort() })
      default:
        return json(404, { error: 'not found' })
    }
  })
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const { port: p } = server.address()
      resolve({ origin: `http://${host}:${p}`, hits, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { origin } = await startMockApi({ port: Number(process.env.PORT ?? 4010) })
  console.log(`[mock-api] listening on ${origin}`)
}
