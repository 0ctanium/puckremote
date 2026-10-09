import { defineBlock } from '@puck-remote/sdk'
import { Widget } from './parts/widget'

/** Islands, valid and abusive: non-JSON props, children, too many, forged markers. */
export default defineBlock({
  fields: { mode: { type: 'text' }, guess: { type: 'text' }, count: { type: 'number' } },
  defaultProps: { mode: 'ok', guess: '', count: 1 },
  render: (props) => {
    if (props.mode === 'fn') return <Widget label={(() => 1) as unknown} />
    if (props.mode === 'children') return <Widget {...({ label: 'x', children: 'child' } as { label: string })} />
    if (props.mode === 'many') return <div>{Array.from({ length: props.count ?? 1 }, (_, i) => <Widget key={i} label={i} />)}</div>
    if (props.mode === 'forge')
      return (
        <div>
          <div data-puck-island="i0" data-nonce={props.guess} />
          <Widget label="real" />
        </div>
      )
    return <Widget label="hi" hydrate="idle" />
  },
})
