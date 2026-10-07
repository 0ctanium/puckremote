import { defineBlock, find } from '@puck-remote/sdk'

/** Reads ?q= from the URL, which makes any page containing it uncacheable. */
export default defineBlock({
  label: 'Search results',
  category: 'Content',
  fields: { heading: { type: 'text' } },
  defaultProps: { heading: 'Search' },
  data: {
    results: find('posts', {
      limit: 10,
      select: ['title', 'slug'],
      where: { title: { contains: { $query: 'q' } } },
    }),
  },
  render: (props, data) => (
    <section className="t-search">
      <h2>{props.heading}</h2>
      <form method="get">
        <input name="q" placeholder="Search posts" />
      </form>
      {data.results.ok ? (
        <ul>
          {data.results.data.docs.map((p) => (
            <li key={p.slug}>{p.title}</li>
          ))}
        </ul>
      ) : (
        <p className="t-unavailable">Search unavailable</p>
      )}
    </section>
  ),
})
