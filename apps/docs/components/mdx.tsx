import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { TypeTable } from 'fumadocs-ui/components/type-table';
import type { MDXComponents } from 'mdx/types';
import { DecisionIndex } from './decision-index';
import { Mermaid } from './mermaid';

/**
 * Repo-relative source reference, e.g. <Source path="packages/core/src/server/surface.ts" />.
 * Plain text for now: the repository has no remote yet.
 */
export function Source({ path }: { path: string }) {
  return (
    <div className="not-prose my-2 flex items-center gap-2 rounded-md border bg-fd-card px-3 py-1.5 text-sm">
      <span className="text-fd-muted-foreground">Source</span>
      <code className="font-mono">{path}</code>
    </div>
  );
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    DecisionIndex,
    File,
    Files,
    Folder,
    Mermaid,
    Source,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    ...components,
  };
}
