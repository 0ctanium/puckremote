import { defineAdapter } from '@puck-remote/sdk'

interface RawEvent {
  uid: string
  name: string
  starts_at: string
  location: { city: string }
}

/** Sans-IO adapter: both functions are pure and synchronous; the host performs the request. */
export default defineAdapter({
  name: 'events',
  origin: 'http://localhost:4010',
  toRequest(q) {
    if (q.op !== 'upcoming') throw new Error(`unknown op ${q.op}`)
    const params: Record<string, string | number> = { limit: Number(q.params.limit ?? 5) }
    if (q.params.city) params.city = String(q.params.city)
    return {
      method: 'GET',
      path: '/v1/events',
      params,
      headers: { 'x-api-key': { $secret: 'EVENTS_API_KEY' } },
    }
  },
  fromResponse(json) {
    const items = (json as { items: RawEvent[] }).items ?? []
    return items.map((e) => ({ id: e.uid, title: e.name, date: e.starts_at.slice(0, 10), city: e.location.city }))
  },
})
