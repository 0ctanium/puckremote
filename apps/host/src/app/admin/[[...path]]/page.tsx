import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { remote } from '@/puck-remote.ts'
import { isAdmin } from '@/admin-auth.ts'
import { AdminEditor } from './AdminEditor.tsx'

export const dynamic = 'force-dynamic'

const EDITOR_URL = process.env.PUCK_REMOTE_EDITOR_URL ?? 'http://127.0.0.1:3300/'

export default async function AdminPage(props: { params: Promise<{ path?: string[] }> }) {
  if (!isAdmin(new Request('http://x/', { headers: await headers() }))) notFound()
  const payload = await remote.loadEditor(props)
  return <AdminEditor payload={payload} editorUrl={EDITOR_URL} />
}
