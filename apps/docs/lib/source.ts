import { loader, update } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';

const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

// ADRs are read straight from .claude/ (single source of truth, D-0099) and mounted inside the
// Internal root at /docs/internal/decisions (D-0108). Templates are excluded: their frontmatter
// holds {{placeholders}}.
const decisions = defineDocs({
  dir: '../../.claude',
  docs: {
    schema: pageSchema,
    files: ['ADR-SYSTEM-GUIDE.md', 'branches/**/*.md', 'merged/**/*.md'],
  },
  meta: { schema: metaSchema, files: [] },
});

export const DECISIONS_PREFIX = 'internal/decisions';

export const source = loader({
  baseUrl: '/docs',
  source: {
    docs: docs.toFumadocsSource(),
    decisions: update(decisions.toFumadocsSource())
      .page((page) => ({ ...page, path: `${DECISIONS_PREFIX}/${page.path}` }))
      .meta((meta) => ({ ...meta, path: `${DECISIONS_PREFIX}/${meta.path}` }))
      .build(),
  },
  plugins: [lucideIconsPlugin()],
});
