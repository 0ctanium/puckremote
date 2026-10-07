/**
 * Turns isolate HTML into React, swapping slot markers for real Puck slots. Shared by the RSC
 * public render and the editor canvas so both paths treat markers identically.
 *
 * A marker is swapped only if ALL hold:
 *  - it is a <div data-puck-slot="NAME" data-nonce="NONCE">
 *  - NONCE equals the per-render nonce the host generated (user content can't know it)
 *  - NAME is a declared slot field of this block
 *  - NAME has not already been swapped in this block (each slot renders at most once)
 * Anything else stays an inert empty div.
 */
import parse, { Element, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser'
import { createElement, Fragment, type ComponentType, type ReactNode } from 'react'

export type SlotRenderer = ComponentType<Record<string, never>> | ReactNode

export function htmlToReact(html: string, opts: { nonce: string; slots: Record<string, SlotRenderer>; allowed: readonly string[] }): ReactNode {
  const seen = new Set<string>()
  const options: HTMLReactParserOptions = {
    replace(node: DOMNode) {
      if (!(node instanceof Element) || node.name !== 'div') return undefined
      const name = node.attribs['data-puck-slot']
      if (name === undefined) return undefined
      if (node.attribs['data-nonce'] !== opts.nonce || !opts.nonce) return undefined
      if (!opts.allowed.includes(name) || !Object.hasOwn(opts.slots, name) || seen.has(name)) return undefined
      seen.add(name)
      const slot = opts.slots[name]
      const content = typeof slot === 'function' ? createElement(slot as ComponentType) : slot
      return createElement(Fragment, { key: `slot:${name}` }, content)
    },
  }
  return parse(html, options)
}
