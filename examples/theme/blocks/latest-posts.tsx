import { defineBlock, find, Slot } from '@poc/sdk'

export default defineBlock({
  label: 'Latest posts',
  category: 'Content',
  fields: {
    heading: { type: 'text' },
    count: { type: 'number', min: 1, max: 12 },
    accent: { type: 'host:color' },
    layout: {
      type: 'select',
      options: [
        { label: 'List', value: 'list' },
        { label: 'Grid', value: 'grid' },
      ],
    },
    columns: { type: 'number', min: 1, max: 4, visibleIf: { field: 'layout', eq: 'grid' } },
    items: { type: 'array', itemSummary: 'title', arrayFields: { title: { type: 'text' } } },
    content: { type: 'slot' },
  },
  defaultProps: { heading: 'Latest', count: 3, layout: 'list', columns: 2, items: [] },
  data: {
    posts: find<{ title: string; slug: string }>('posts', {
      limit: { $prop: 'count' },
      sort: '-publishedAt',
      select: ['title', 'slug'],
      where: { status: { equals: 'published' } },
    }),
  },
  render: (props, data) => (
    <section className={`t-posts t-posts--${props.layout}`} style={{ borderColor: props.accent, ['--cols' as string]: props.columns }}>
      <h2>{props.heading}</h2>
      {data.posts.ok ? (
        <ul>
          {data.posts.data.docs.map((p) => (
            <li key={p.slug}>
              <a href={`/posts/${p.slug}`}>{p.title}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-unavailable">Unavailable</p>
      )}
      {props.items?.length > 0 && (
        <ul className="t-pinned">
          {props.items.map((it, i) => (
            <li key={i}>{it.title}</li>
          ))}
        </ul>
      )}
      <Slot name="content" />
    </section>
  ),
})
