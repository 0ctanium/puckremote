import { EditorClient } from '@puck-remote/next'
import { remote } from '@/puck-remote.ts'

export const dynamic = 'force-dynamic'

export default async function EditorPage(props: { params: Promise<{ path?: string[] }> }) {
  return (
    <div style={{ height: '100vh' }}>
      <EditorClient {...await remote.loadEditor(props)} />
    </div>
  )
}
