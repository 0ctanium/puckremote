import { defineBlock, query } from '@poc/sdk'

interface Event {
  id: string
  title: string
  date: string
  city: string
}

export default defineBlock({
  label: 'Event list',
  category: 'Data',
  fields: {
    heading: { type: 'text' },
    city: {
      type: 'select',
      options: [
        { label: 'All cities', value: '' },
        { label: 'Paris', value: 'paris' },
        { label: 'Lyon', value: 'lyon' },
      ],
    },
    count: { type: 'number', min: 1, max: 20 },
  },
  defaultProps: { heading: 'Upcoming events', city: '', count: 5 },
  data: {
    events: query<Event[]>('events', 'upcoming', { limit: { $prop: 'count' }, city: { $prop: 'city' } }),
  },
  render: (props, data) => (
    <section className="t-events">
      <h2>{props.heading}</h2>
      {!data.events.ok ? (
        <p className="t-unavailable">Events are unavailable right now.</p>
      ) : data.events.data.length === 0 ? (
        <p>No upcoming events.</p>
      ) : (
        <ol>
          {data.events.data.map((e) => (
            <li key={e.id}>
              <time dateTime={e.date}>{e.date}</time> {e.title} <em>({e.city})</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  ),
})
