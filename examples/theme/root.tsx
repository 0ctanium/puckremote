import { defineRoot, global, Slot } from '@puck-remote/sdk'

export default defineRoot({
  fields: {
    title: { type: 'text', label: 'Page title' },
    description: { type: 'textarea', label: 'Meta description' },
    theme: {
      type: 'radio',
      options: [
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
      ],
    },
  },
  defaultProps: { title: 'Untitled page', description: '', theme: 'light' },
  data: {
    site: global('site'),
  },
  render: (props, data, ctx) => {
    ctx.head.title(`${props.title} · ${ctx.site.name}`)
    if (props.description) ctx.head.meta('description', props.description)
    ctx.assets.style(ctx.assetUrl('theme.css'))
    ctx.assets.script(ctx.assetUrl('enhance.js'), { defer: true })
    return (
      <div className="t-site" data-theme={props.theme}>
        <header className="t-header">
          <strong>{ctx.site.name}</strong>
          {data.site.ok && <span className="t-tagline">{data.site.data.tagline}</span>}
        </header>
        <main className="t-main">
          <Slot name="children" />
        </main>
        <footer className="t-footer">{data.site.ok ? data.site.data.footer : '©'}</footer>
      </div>
    )
  },
})
