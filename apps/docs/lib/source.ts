import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';

const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

// ADRs are read straight from .claude/ (single source of truth, D-0099).
// Templates are excluded: their frontmatter holds {{placeholders}}.
const decisions = defineDocs({
  dir: '../../.claude',
  docs: {
    schema: pageSchema,
    files: ['ADR-SYSTEM-GUIDE.md', 'branches/**/*.md', 'merged/**/*.md'],
  },
  meta: { schema: metaSchema, files: [] },
});

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

export const decisionSource = loader({
  baseUrl: '/decisions',
  source: decisions.toFumadocsSource(),
});
