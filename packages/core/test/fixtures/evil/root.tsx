import { defineRoot, Slot } from '@puck-remote/sdk'

export default defineRoot({
  fields: {},
  render: () => (
    <div id="root">
      <Slot name="children" />
    </div>
  ),
})
