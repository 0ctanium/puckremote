import { defineBlock, find, Slot } from '@puck-remote/sdk'

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
    // Typed from the registered host data source: collection names, fields, sort keys and the
    // result shape (Pick<Post, 'id' | 'title' | 'slug' | 'author'>) are all checked.
    posts: find('posts', {
      limit: { $prop: 'count' },
      sort: '-publishedAt',
      select: ['title', 'slug', 'author'],
      depth: 1,
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
              {typeof p.author === 'object' && <span className="t-author"> by {p.author.name}</span>}
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
