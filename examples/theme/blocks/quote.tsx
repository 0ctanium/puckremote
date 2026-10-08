import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  label: 'Quote',
  category: 'Content',
  fields: {
    text: { type: 'textarea' },
    author: { type: 'text' },
  },
  defaultProps: { text: 'Programs must be written for people to read.', author: 'Harold Abelson' },
  render: (props) => (
    <blockquote className="t-quote">
      <p>{props.text}</p>
      {props.author && <cite>— {props.author}</cite>}
    </blockquote>
  ),
})
