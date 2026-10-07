import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  fields: { size: { type: 'number' } },
  defaultProps: { size: 2_000_000 },
  render: (props) => <div>{'y'.repeat(props.size)}</div>,
})
