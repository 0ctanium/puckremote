import { getHost } from '@/server/host.ts'

/** Manual artifact reload (the file watcher also reloads on current.json changes). */
export async function POST() {
  const host = await getHost()
  const r = await host.store.reload()
  return Response.json(r, { status: r.ok ? 200 : 500 })
}
