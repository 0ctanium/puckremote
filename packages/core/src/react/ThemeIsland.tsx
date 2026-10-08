'use client'
/**
 * One island on a public page: a theme client component (an export of a "use client" module).
 * It shows the isolate's server HTML, then, when its `hydrate` trigger fires, loads the theme's
 * islands bundle once and hydrates that HTML in its own React root. Internal: rendered by
 * <PuckRemotePage>, not by apps.
 */
import { registerSharedModules } from '@puck-remote/sdk/browser'
import { createElement, useEffect, useRef, type ComponentType } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'

export interface ThemeIslandProps {
  /** URL of the artifact's bundle.islands.js. */
  src: string
  /** "<theme-relative path>#<export>". */
  id: string
  props: Record<string, unknown>
  hydrate: 'load' | 'idle' | 'visible'
  /** Server HTML from the isolate (normalized on the server). */
  html: string
}

type IslandsModule = Record<string, ComponentType<Record<string, unknown>>>

const bundles = new Map<string, Promise<IslandsModule>>()

function loadBundle(src: string): Promise<IslandsModule> {
  let p = bundles.get(src)
  if (!p) {
    registerSharedModules()
    p = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ src).then((m) => m.default as IslandsModule)
    bundles.set(src, p)
  }
  return p
}

/** Calls start() when the trigger fires; returns a cancel function. */
function when(el: HTMLElement, mode: ThemeIslandProps['hydrate'], start: () => void): () => void {
  if (mode === 'idle') {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start)
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(start, 200)
    return () => clearTimeout(t)
  }
  // The wrapper is display: contents (no box), so observe what it renders.
  const target = el.firstElementChild
  if (mode === 'visible' && target && typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        start()
      },
      { rootMargin: '200px' },
    )
    io.observe(target)
    return () => io.disconnect()
  }
  start()
  return () => {}
}

// Roots outlive a cleanup by one task, so a StrictMode remount reuses the hydrated root instead of
// hydrating a container React already owns.
const roots = new WeakMap<HTMLElement, { root: Root; component: ComponentType<Record<string, unknown>>; timer?: ReturnType<typeof setTimeout> }>()

export function ThemeIsland({ src, id, props, hydrate, html }: ThemeIslandProps) {
  const ref = useRef<HTMLDivElement>(null)
  const propsKey = JSON.stringify(props)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const existing = roots.get(el)
    let stop = () => {}
    if (existing) {
      clearTimeout(existing.timer)
      existing.timer = undefined
      existing.root.render(createElement(existing.component, props))
    } else {
      stop = when(el, hydrate, () => {
        loadBundle(src)
          .then((mod) => {
            if (cancelled) return
            const component = Object.hasOwn(mod, id) ? mod[id] : undefined
            if (typeof component !== 'function') throw new Error(`island ${id} is not in ${src}`)
            roots.set(el, { root: hydrateRoot(el, createElement(component, props)), component })
          })
          .catch((e) => console.error('[puck-remote] island failed to hydrate:', e))
      })
    }
    return () => {
      cancelled = true
      stop()
      const entry = roots.get(el)
      if (entry)
        entry.timer = setTimeout(() => {
          entry.root.unmount()
          roots.delete(el)
        }, 0)
    }
    // props are compared by value (propsKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, id, hydrate, propsKey])

  return <div ref={ref} data-puck-island={id} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} suppressHydrationWarning />
}
