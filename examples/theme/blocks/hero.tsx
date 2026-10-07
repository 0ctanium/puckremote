import { defineBlock, Slot } from '@puck-remote/sdk'

export default defineBlock({
  label: 'Hero',
  category: 'Layout',
  fields: {
    title: { type: 'text' },
    subtitle: { type: 'textarea' },
    align: {
      type: 'select',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
      ],
    },
    background: { type: 'host:color' },
    image: { type: 'host:media' },
    showCta: {
      type: 'radio',
      label: 'Show call to action',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    cta: { type: 'host:link', label: 'Call to action', visibleIf: { field: 'showCta', eq: true } },
    content: { type: 'slot' },
  },
  defaultProps: { title: 'Hello', subtitle: '', align: 'left', background: '#f4f1ea', showCta: false },
  render: (props, _data, ctx) => (
    <section className={`t-hero t-hero--${props.align}`} style={{ background: props.background }}>
      {props.image?.url && <img className="t-hero__img" src={props.image.url} alt={props.image.alt ?? ''} />}
      <h1>{props.title}</h1>
      {props.subtitle && <p className="t-hero__sub">{props.subtitle}</p>}
      {props.showCta && props.cta?.href && (
        <a className="t-btn" href={props.cta.href} target={props.cta.newTab ? '_blank' : undefined} data-enhance="cta">
          {props.cta.label || 'Learn more'}
        </a>
      )}
      <div className="t-hero__content">
        <Slot name="content" />
      </div>
      {ctx.isEditing && <small className="t-edit-hint">Drop blocks into the hero body</small>}
    </section>
  ),
})
