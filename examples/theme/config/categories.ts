import { defineCategories } from '@puck-remote/sdk'

export default defineCategories({
  Layout: { title: 'Layout', components: ['hero', 'card'], defaultExpanded: true },
  Content: { title: 'Content' },
  Data: { title: 'External data' },
})
