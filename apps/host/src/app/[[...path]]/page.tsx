import { PuckRemotePage, type PageProps } from '@puck-remote/next'
import { remote } from '@/puck-remote.ts'

export const dynamic = 'force-dynamic'
export const generateMetadata = remote.generateMetadata

export default async function Page(props: PageProps) {
  const page = await remote.loadPage(props)
  return <PuckRemotePage page={page} />
}
