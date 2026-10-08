// Global MDX options (D-0112). Collections are defined in lib/source.ts with the macro API.
import { defineConfig } from 'fumadocs-mdx/config';
import { remarkMdxFiles } from 'fumadocs-core/mdx-plugins/remark-mdx-files';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins/remark-mdx-mermaid';

export default defineConfig({
  mdxOptions: {
    // ```mermaid → <Mermaid chart="…" /> and ```files → <Files>… (D-0110, D-0111)
    remarkPlugins: [remarkMdxMermaid, remarkMdxFiles],
    remarkNpmOptions: { persist: { id: 'package-manager' } },
  },
});
