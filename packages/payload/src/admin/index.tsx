/**
 * `@puck-remote/payload/admin` — the plugin's admin views (server components, referenced by
 * Payload's import map): the themes, like Shopify's theme library, and the editor.
 */
import type { Theme } from '@puck-remote/core'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import type { ReactNode } from 'react'
import type { ResolvedPluginOptions } from '../plugin.ts'
import type { PayloadUser } from '../source.ts'
// Its own entry (a 'use client' boundary), not bundled into this one.
import { EditorClient, ThemeActions } from '@puck-remote/payload/admin/client'

type ViewProps = AdminViewServerProps & { puckRemote: ResolvedPluginOptions }

const ROLE_LABEL: Record<Theme['role'], string> = {
  main: 'Current theme',
  unpublished: 'Theme library',
  development: 'Development themes',
}

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? undefined : v)

/** Payload's admin frame (nav, header) around a view. */
function Frame({ props, children }: { props: ViewProps; children: ReactNode }) {
  const { initPageResult: r, params, searchParams } = props
  return (
    <DefaultTemplate
      i18n={r.req.i18n}
      locale={r.locale}
      params={params}
      payload={r.req.payload}
      permissions={r.permissions}
      searchParams={searchParams}
      user={r.req.user ?? undefined}
      visibleEntities={r.visibleEntities}
    >
      <Gutter>{children}</Gutter>
    </DefaultTemplate>
  )
}

/** The signed-in user when they may use puck-remote's views; otherwise null. */
async function allowedUser(props: ViewProps): Promise<PayloadUser | null> {
  const user = props.initPageResult.req.user as PayloadUser | null
  return user && (await props.puckRemote.access({ user })) ? user : null
}

function Message({ props, children }: { props: ViewProps; children: ReactNode }) {
  return (
    <Frame props={props}>
      <p style={{ margin: '48px 0' }}>{children}</p>
    </Frame>
  )
}

/** /admin/puck-remote: the site's themes, grouped by role. */
export async function ThemesView(props: ViewProps) {
  if (!(await allowedUser(props))) return <Message props={props}>You are not allowed to manage themes.</Message>
  const core = await props.puckRemote.core()
  const themes = await core.themes.list()
  const { routes } = props.initPageResult.req.payload.config
  const editor = (theme: Theme) => `${routes.admin}/puck-remote/editor${theme.role === 'main' ? '' : `?theme=${theme.id}`}`
  return (
    <Frame props={props}>
      <h1 style={{ margin: '24px 0 8px' }}>Themes</h1>
      {!themes.length && <p>No theme yet: push one with the puck-remote CLI.</p>}
      {(['main', 'unpublished', 'development'] as const).map((role) => {
        const list = themes.filter((t) => t.role === role)
        if (!list.length) return null
        return (
          <section key={role} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '16px 0 8px' }}>{ROLE_LABEL[role]}</h2>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {list.map((theme) => {
                  const preview = core.createPreviewUrl(theme)
                  return (
                    <tr key={theme.id} style={{ borderTop: '1px solid var(--theme-elevation-100)' }} data-testid={`theme-${theme.id}`}>
                      <td style={{ padding: '8px 8px 8px 0' }}>
                        <strong>{theme.name}</strong>
                        <div style={{ color: 'var(--theme-elevation-500)', fontSize: 12 }}>
                          #{theme.id} · updated {when(theme.updatedAt)} · <code>{theme.hash?.slice(0, 12) ?? 'no files yet'}</code>
                        </div>
                      </td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                        <a href={editor(theme)}>Customize</a>
                        {preview && (
                          <>
                            {' · '}
                            <a href={preview} target="_blank" rel="noreferrer">
                              Preview
                            </a>
                          </>
                        )}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <ThemeActions api={routes.api} theme={{ id: theme.id, name: theme.name, role: theme.role }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}
    </Frame>
  )
}

/** /admin/puck-remote/editor?previewPath=/x&theme=<id>: the editor on a template of a theme. */
export async function EditorView(props: ViewProps) {
  const user = await allowedUser(props)
  if (!user) return <Message props={props}>You are not allowed to edit themes.</Message>
  const o = props.puckRemote
  const search = props.searchParams ?? {}
  const target = o.template(first(search.previewPath) ?? '/')
  if (!target) return <Message props={props}>This path does not render a template.</Message>
  const core = await o.core()
  const ref = first(search.theme)
  const theme = ref ? await core.themes.get(/^[0-9a-f]{12}$/.test(ref) ? ref : '') : await core.themes.main()
  if (!theme) return <Message props={props}>No such theme.</Message>
  const payload = await core.editorPayload(target.name, { params: target.params, theme: theme.id })
  const { routes } = props.initPageResult.req.payload.config
  return (
    <EditorClient
      payload={payload}
      editorUrl={o.editorUrl}
      api={routes.api}
      themesUrl={`${routes.admin}/puck-remote`}
      previewUrl={core.createPreviewUrl(theme)}
      user={String(user.email ?? user.id)}
      theme={{ id: theme.id, name: theme.name, role: theme.role }}
    />
  )
}

/** Nav link to the themes view (after Payload's own links). */
export function NavLink(props: { payload: { config: { routes: { admin: string } } } }) {
  return (
    <a className="nav__link" href={`${props.payload.config.routes.admin}/puck-remote`} id="nav-puck-remote-themes">
      <span className="nav__link-label">Themes</span>
    </a>
  )
}
