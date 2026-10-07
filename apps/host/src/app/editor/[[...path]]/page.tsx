import { EditorClient } from '@poc/next'
import { poc } from '@/poc.ts'

export const dynamic = 'force-dynamic'

export default async function EditorPage(props: { params: Promise<{ path?: string[] }> }) {
  return (
    <div style={{ height: '100vh' }}>
      <EditorClient {...await poc.loadEditor(props)} />
    </div>
  )
}
