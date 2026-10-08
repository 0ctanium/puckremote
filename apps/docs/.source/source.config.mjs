// source.config.ts
import { defineConfig } from "fumadocs-mdx/config";
import { remarkMdxFiles } from "fumadocs-core/mdx-plugins/remark-mdx-files";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins/remark-mdx-mermaid";
var source_config_default = defineConfig({
  mdxOptions: {
    // ```mermaid → <Mermaid chart="…" /> and ```files → <Files>… (D-0110, D-0111)
    remarkPlugins: [remarkMdxMermaid, remarkMdxFiles],
    remarkNpmOptions: { persist: { id: "package-manager" } }
  }
});
export {
  source_config_default as default
};
