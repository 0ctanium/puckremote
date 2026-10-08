import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  label: 'Quote',
  category: 'Content',
  // v2 renamed `author` to `cite`; pages saved with v1 are migrated when they are read.
  version: 2,
  migrations: {
    2: ({ author, ...props }) => ({ ...props, cite: author }),
  },
  fields: {
    text: { type: 'textarea' },
    cite: { type: 'text' },
  },
  defaultProps: { text: 'Programs must be written for people to read.', cite: 'Harold Abelson' },
  render: (props) => (
    <blockquote className="t-quote">
      <p>{props.text}</p>
      {props.cite && <cite>— {props.cite}</cite>}
    </blockquote>
  ),
})
