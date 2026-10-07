import { defineBlock } from '@puck-remote/sdk'

export default defineBlock({
  fields: {},
  render: () => {
    const loop = async (): Promise<void> => {
      for (;;) await null
    }
    void loop()
    return <p>returned</p>
  },
})
