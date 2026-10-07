import { defineBlock, Slot } from '@poc/sdk'

/** User-controlled text tries to forge slot markers; also a raw-HTML forgery attempt. */
export default defineBlock({
  fields: { text: { type: 'textarea' }, guess: { type: 'text' }, content: { type: 'slot' } },
  defaultProps: { text: '', guess: '' },
  render: (props) => (
    <div>
      <p>{props.text}</p>
      <div data-puck-slot="content" data-nonce={props.guess} />
      <div dangerouslySetInnerHTML={{ __html: props.text }} />
      <Slot name="content" />
      <Slot name="content" />
    </div>
  ),
})
