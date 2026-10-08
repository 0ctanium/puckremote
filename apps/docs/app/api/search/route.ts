import { createSearchAPI } from 'fumadocs-core/search/server';
import { decisionSource, source } from '@/lib/source';

// One index over the docs and the decision records.
export const { GET } = createSearchAPI('advanced', {
  indexes: () =>
    [...source.getPages(), ...decisionSource.getPages()].map((page) => ({
      id: page.url,
      title: page.data.title ?? page.url,
      description: page.data.description,
      url: page.url,
      structuredData: page.data.structuredData,
      tag: page.url.startsWith('/decisions') ? 'decisions' : 'docs',
    })),
});
