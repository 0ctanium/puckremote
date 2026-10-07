/**
 * Loads the artifact's bundle.js into a hidden same-origin iframe and exposes its synchronous
 * entry points. A separate realm keeps the isolate shims (which replace MessageChannel and
 * TextEncoder) and any global mutation by developer code out of the editor's own window.
 *
 * NOT a security boundary: same origin. Production must serve the editor from its own origin.
 */
export interface BundleApi {
  render(kind: 'block' | 'root', name: string, propsJson: string, dataJson: string, ctxJson: string): string
}

const loaded = new Map<number, Promise<BundleApi>>()

export function loadBundle(version: number, url: string): Promise<BundleApi> {
  if (!loaded.has(version)) {
    loaded.set(
      version,
      new Promise((resolve, reject) => {
        const frame = document.createElement('iframe')
        frame.title = `theme bundle v${version}`
        frame.setAttribute('aria-hidden', 'true')
        frame.style.display = 'none'
        frame.srcdoc = `<!doctype html><script src="${encodeURI(url)}"></script>`
        // The iframe can fire 'load' for its initial about:blank document before the srcdoc one,
        // so readiness is "__render exists", checked on every load and by polling.
        const started = Date.now()
        const check = () => {
          const w = frame.contentWindow as (Window & { __render?: BundleApi['render'] }) | null
          if (typeof w?.__render === 'function') {
            clearInterval(timer)
            const r = w.__render
            resolve({ render: (...args) => r(...args) })
          } else if (Date.now() - started > 15_000) {
            clearInterval(timer)
            reject(new Error('bundle did not install __render'))
          }
        }
        const timer = setInterval(check, 50)
        frame.addEventListener('load', check)
        frame.onerror = () => reject(new Error('failed to load bundle'))
        document.body.appendChild(frame)
      }),
    )
  }
  return loaded.get(version)!
}

export function newNonce(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
