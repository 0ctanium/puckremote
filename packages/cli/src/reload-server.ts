/**
 * Live reload for `puck-remote dev`, like Vite's: a tiny Server-Sent Events server on the loopback
 * interface. Preview pages (opened with the link `dev` prints) listen to `GET /events` and reload on
 * a `reload` event, sent after each successful push.
 */
import { createServer, type Server, type ServerResponse } from 'node:http'

export const DEFAULT_RELOAD_PORT = 9293
/** Ports tried after the requested one when it is busy. */
const PORT_ATTEMPTS = 11
const PING_MS = 15_000

export interface ReloadServer {
  /** http://127.0.0.1:<port>, the value passed to the preview link (`&reload=`). */
  url: string
  port: number
  /** Tell every connected page to reload. */
  reload(data: { theme: string; hash: string }): void
  /** Connected pages. */
  clients(): number
  close(): Promise<void>
}

function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (e.code === 'EADDRINUSE') resolve(false)
      else reject(e)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(true)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

/** Start the server on `port`, or the next free one (up to +10). */
export async function startReloadServer(opts: { port?: number } = {}): Promise<ReloadServer> {
  const clients = new Set<ServerResponse>()
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || pathname !== '/events') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // Preview pages live on the site's origin.
      'access-control-allow-origin': '*',
    })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
  })
  const ping = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n')
  }, PING_MS)
  ping.unref()

  const first = opts.port ?? DEFAULT_RELOAD_PORT
  let port = 0
  for (let p = first; p < first + PORT_ATTEMPTS; p++) {
    if (await listen(server, p)) {
      port = p
      break
    }
  }
  if (!port) {
    clearInterval(ping)
    throw new Error(`no free port for live reload between ${first} and ${first + PORT_ATTEMPTS - 1}`)
  }
  server.unref()

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    reload(data) {
      const msg = `event: reload\ndata: ${JSON.stringify(data)}\n\n`
      for (const c of clients) c.write(msg)
    },
    clients: () => clients.size,
    close() {
      clearInterval(ping)
      for (const c of clients) c.end()
      clients.clear()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
