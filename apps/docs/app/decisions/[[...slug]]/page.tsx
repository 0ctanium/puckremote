import { decisionSource } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { DecisionIndex } from '@/components/decision-index';

export default async function Page(props: PageProps<'/decisions/[[...slug]]'>) {
  const params = await props.params;
  if (!params.slug?.length) {
    return (
      <DocsPage>
        <DocsTitle>Decisions</DocsTitle>
        <DocsDescription>
          Every decision recorded in .claude/adr-index.toml, grouped by ADR. Agents never decide
          alone: each entry carries its provenance.
        </DocsDescription>
        <DocsBody>
          <DecisionIndex />
        </DocsBody>
      </DocsPage>
    );
  }
  const page = decisionSource.getPage(params.slug);
  if (!page) notFound();
  const MDX = page.data.body;
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return [{ slug: [] }, ...decisionSource.generateParams()];
}

export async function generateMetadata(props: PageProps<'/decisions/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  if (!params.slug?.length) return { title: 'Decisions' };
  const page = decisionSource.getPage(params.slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
