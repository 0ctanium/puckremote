import { defineBlock, Slot } from '@poc/sdk'

export default defineBlock({
  label: 'Card',
  category: 'Layout',
  fields: {
    title: { type: 'text' },
    body: { type: 'textarea' },
    tone: {
      type: 'select',
      options: [
        { label: 'Plain', value: 'plain' },
        { label: 'Accent', value: 'accent' },
      ],
    },
    content: { type: 'slot' },
  },
  defaultProps: { title: 'Card', body: '', tone: 'plain' },
  render: (props) => (
    <article className={`t-card t-card--${props.tone}`}>
      <h3>{props.title}</h3>
      {props.body && <p>{props.body}</p>}
      <Slot name="content" />
    </article>
  ),
})
