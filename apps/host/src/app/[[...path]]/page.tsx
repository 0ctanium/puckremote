import { PocPage, type PageProps } from '@poc/next'
import { poc } from '@/poc.ts'

export const dynamic = 'force-dynamic'
export const generateMetadata = poc.generateMetadata

export default async function Page(props: PageProps) {
  const page = await poc.loadPage(props)
  return <PocPage page={page} />
}
