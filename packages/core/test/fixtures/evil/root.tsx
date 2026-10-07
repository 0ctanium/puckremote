import { defineRoot, Slot } from '@poc/sdk'

export default defineRoot({
  fields: {},
  render: () => (
    <div id="root">
      <Slot name="children" />
    </div>
  ),
})
