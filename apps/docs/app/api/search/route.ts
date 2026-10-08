import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// One loader holds the docs and the decision records (D-0108), so one index covers both.
export const { GET } = createFromSource(source);
