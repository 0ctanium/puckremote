/**
 * puck-remote-editor: serve the static editor with node:http.
 *
 *   puck-remote-editor --admin-origins https://admin.example.com [--port 3300] [--host 127.0.0.1]
 */
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { createEditorHandler } from './server.ts'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3300' },
    host: { type: 'string', default: '127.0.0.1' },
    'admin-origins': { type: 'string', default: process.env.PUCK_REMOTE_ADMIN_ORIGINS },
  },
})
const adminOrigins = (values['admin-origins'] ?? '').split(',').map((o) => o.trim()).filter(Boolean)
if (!adminOrigins.length) {
  console.error('usage: puck-remote-editor --admin-origins <origin,…> [--port 3300] [--host 127.0.0.1]  (or PUCK_REMOTE_ADMIN_ORIGINS)')
  process.exit(2)
}
const handle = createEditorHandler({ adminOrigins })

createServer(async (req, res) => {
  const response = await handle(new Request(new URL(req.url ?? '/', 'http://editor.invalid'), { method: req.method }))
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined)
}).listen(Number(values.port), values.host, () => {
  console.log(`[puck-remote-editor] http://${values.host}:${values.port} (embeddable by ${adminOrigins.join(', ')})`)
})
