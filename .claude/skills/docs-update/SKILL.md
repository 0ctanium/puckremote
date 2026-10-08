---
name: docs-update
description: Keep the Fumadocs documentation (apps/docs) in sync with code changes in puck-remote — which pages document which code, MDX conventions, and how to verify the build. Use whenever code, config, defaults, APIs or behavior change.
---

# Updating the docs

Every code change updates the docs in the same change (hooks and CI check it). The code → page
map is in `apps/docs/content/docs/contributing/docs.mdx`; keep that table up to date too.

## Steps

1. Find affected pages:
   ```bash
   grep -rl "<changed function, option or file name>" apps/docs/content/docs
   ```
   Also check `reference/config.mdx` (defaults), `reference/http-api.mdx` (endpoints),
   `reference/environment.mdx` (env vars), `internals/testing.mdx` (test map),
   `internals/known-gaps.mdx`.
2. Update them. Explain **why** and link decisions as `[D-NNNN](/decisions#D-NNNN)`. End internals
   pages with `<Source path="repo/relative/path" />` per implementing file.
3. New page: add the `.mdx` file with `title` and `description` frontmatter and list it in the
   folder's `meta.json`.
4. Verify:
   ```bash
   pnpm docs:build
   ```

## MDX pitfalls

- Braces and angle brackets in prose are parsed as JSX: put them in backticks.
- In tables, escape `|` inside code as `\|`.
- One command per `bash` block.

## Decisions are docs too

ADRs in `.claude/branches|merged` render under `/decisions` automatically; they need frontmatter
`title` and `description`. The `/decisions` index is generated from `adr-index.toml`.
