/**
 * Server side of the admin page's calls: the editor's allow-listed RPCs (relayed by
 * <PuckEditorFrame>) and the admin's own actions. The iframe can only reach what the frame's
 * client-side `rpc` map relays (resolveData); `publish` is called by the host UI only.
 */
import { normalizeSlug, PageError } from '@puck-remote/core'
import { remote } from '@/puck-remote.ts'
import { isAdmin } from '@/admin-auth.ts'

function requireAdmin(request: Request) {
  if (!isAdmin(request)) throw new Error('forbidden')
}

export const { POST } = remote.createEditorRpcRoute({
  // The page slug comes from the admin page's state, not from the editor.
  async resolveData(params, request) {
    requireAdmin(request)
    const { slug, block, props } = (params ?? {}) as { slug?: string; block?: string; props?: Record<string, unknown> }
    const s = normalizeSlug(slug)
    if (!s || typeof block !== 'string' || !props || typeof props !== 'object') throw new Error('invalid params')
    return remote.core.resolveBlockData(s, block, props)
  },

  // The demo's publishing plugin: "save = write the page into a new artifact + make it current".
  // Drafts, review or history would be other plugins on the same two primitives.
  async publish(params, request) {
    requireAdmin(request)
    const { slug, data, base } = (params ?? {}) as { slug?: string; data?: unknown; base?: string }
    const s = normalizeSlug(slug)
    if (!s || typeof base !== 'string') throw new Error('invalid params')
    const { artifacts } = remote.core.config
    // Writing on an old base would undo whatever was published since (pages or theme code).
    if ((await artifacts.readPointer()) !== base) return { ok: false, error: 'conflict' }
    try {
      const { id } = await remote.core.writePage(s, data, { base })
      await artifacts.writePointer(id)
      await (await remote.core.host()).store.reload()
      return { ok: true, id }
    } catch (e) {
      if (e instanceof PageError) return { ok: false, error: e.message }
      throw e
    }
  },
})
