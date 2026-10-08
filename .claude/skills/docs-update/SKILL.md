---
name: docs-update
description: Keep the Fumadocs documentation (apps/docs) in sync with code changes in puck-remote — which pages document which code, MDX conventions, and how to verify the build. Use whenever code, config, defaults, APIs or behavior change.
---

# Updating the docs

Every code change updates the docs in the same change (hooks and CI check it). The code → page
map is in `apps/docs/content/docs/internal/contributing/docs.mdx`; keep that table up to date too.

## Steps

1. Find affected pages:
   ```bash
   grep -rl "<changed function, option or file name>" apps/docs/content/docs
   ```
   Also check `(framework)/configuration.mdx` (defaults), `(framework)/http-api.mdx`
   (endpoints), `(framework)/environment.mdx` (env vars), `core/adapters/*` (contracts),
   `internal/quality/testing.mdx` (test map), `internal/quality/known-gaps.mdx`.
   Respect the audience rule: usage in Framework/Core/CLI/SDK; implementation details and
   `<Source>` references in `internal/`.
2. Update them. Explain **why** and link decisions as `[D-NNNN](/docs/internal/decisions#D-NNNN)`. End `internal/architecture`
   pages with `<Source path="repo/relative/path" />` per implementing file.
3. New page: add the `.mdx` file with `title` and `description` frontmatter and list it in the
   folder's `meta.json`.
4. Verify:
   ```bash
   pnpm docs:build
   ```

## Components (see internal/contributing/docs.mdx)

- Options, members, props: `<TypeTable type={{ … }} />` (JS strings; double-quote descriptions).
- Directory trees: fenced `files` block (no comments in tree lines).
- Install commands: fenced `npm` block (rendered as package-manager tabs).
- Code: `title="file.ts"`; alternatives as consecutive blocks with `tab="…"`.
- Procedures: `<Steps>` / `<Step>`; diagrams: fenced `mermaid` block; `<Cards>`, `<Callout>`.

## MDX pitfalls

- Braces and angle brackets in prose are parsed as JSX: put them in backticks.
- In tables, escape `|` inside code as `\|`.
- One command per `bash` block.

## Decisions are docs too

ADRs in `.claude/branches|merged` render under `/docs/internal/decisions` automatically; they need frontmatter
`title` and `description`. The index page (`internal/decisions/index.mdx`, `<DecisionIndex />`) is generated from `adr-index.toml`.
