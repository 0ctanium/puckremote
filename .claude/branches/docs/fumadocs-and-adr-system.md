---
title: "Docs (Fumadocs), ADR decision system, agent rules and enforcement"
description: Full Fumadocs documentation, an ADR/decision log with provenance, skills for agents, and hooks/CI that enforce plan approval, decision logging and docs updates. Also records roadmap decisions not yet implemented.
---

# Branch ADR: docs/fumadocs-and-adr-system

## Meta
- **Branch**: docs/fumadocs-and-adr-system
- **Type**: docs
- **Created**: 2026-10-08
- **Status**: Active
- **Author**: Claude
- **Approved by**: project owner (answers to three questions plus the approved plan)
- **PR**: (not yet created; the repository has no remote)

## Problem Statement
### Context
Project knowledge was spread over README.md, ARCHITECTURE.md and a long conversation. The owner
asked for:
- complete Fumadocs documentation, including internals;
- every decision stored in the project;
- skills that help agents find information;
- rules that stop agents from deciding anything without human validation.

### Goals
- A browsable, searchable docs site.
- A decision log with IDs and provenance.
- Enforcement through instructions, Claude Code hooks, a pre-commit hook and CI.

### Non-Goals
Changing product behaviour.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0092 | Documentation site built with Fumadocs (apps/docs), covering usage, reference and internals | user | accepted |
| D-0093 | Decision log follows the owner's ADR system guide (branch ADRs, TOML index, templates, helper, archive) plus decision IDs and provenance | user | accepted |
| D-0094 | AI agents never decide alone: every choice, even minor, is made or validated by a human via an approved plan | user | accepted |
| D-0095 | Enforcement: instructions + Claude Code hooks (plan gate, docs/ADR stop check) + git pre-commit + CI check | user | accepted |
| D-0096 | Backfill every past decision with provenance; agent-made ones flagged needs-review | user | accepted |
| D-0097 | Branch per unit of work (type/slug) with its ADR; a human merges to main; ADR archived after merge | user-approved-plan | accepted |
| D-0098 | README becomes a quick start + link; ARCHITECTURE.md becomes a pointer; content moves into the docs | user-approved-plan | accepted |
| D-0099 | ADRs are rendered in the docs straight from .claude/ (single source, no copies) | user-approved-plan | accepted |
| D-0100 | Hook blocks write-like Bash commands without an approved plan using a documented heuristic; SKIP_DOCS_CHECK is human-only | user-approved-plan | accepted |
| D-0101 | Decisions is its own docs section (/docs/internal/decisions) with a generated index (one anchor per ID); search covers docs and ADRs | user-approved-plan | superseded by D-0108 |
| D-0102 | Docs app dev dependencies pinned to exact versions (repo convention: only peers use ranges) | user-approved-plan | accepted |
| D-0103 | .claude/launch.json untracked (machine paths); local docs dev-server entry added | user-approved-plan | accepted |
| D-0104 | Stop hook judges the whole branch (commits not on main plus working tree) | user-approved-plan | accepted |
| D-0105 | CI builds docs on ubuntu/node26 only; docs-adr job diffs origin/<base> on PRs, before on pushes, HEAD~1 when there is no previous commit | user-approved-plan | accepted |
| D-0106 | Git hooks enabled by the root prepare script (core.hooksPath=.githooks), no-op outside a git checkout | user-approved-plan | accepted |
| D-0107 | Docs split into five Layout Tab roots: Framework (/docs, includes @puck-remote/next), Core (with an Adapters section), CLI, SDK, Internal | user | accepted |
| D-0108 | Decisions rendered inside the Internal root (/docs/internal/decisions) from .claude via one loader with prefixed ADR paths; search back to createFromSource | user-approved-plan | accepted |
| D-0109 | Install docs use package-manager tabs (npm code blocks) plus a not-yet-published callout pointing to the monorepo | user | accepted |
| D-0110 | Mermaid diagrams rendered on the server with beautiful-mermaid; fenced mermaid blocks via remarkMdxMermaid, code-block fallback on error | user | accepted |
| D-0111 | Docs component conventions: TypeTable for options/members/props, Files for layouts (remarkMdxFiles), titled/tabbed code blocks, Steps, Cards, Callouts | user-approved-plan | accepted |
| D-0112 | Global MDX plugins in apps/docs/source.config.ts; collections stay in lib/source.ts (macro API) | user-approved-plan | accepted |
| D-0113 | Root icons via lucideIconsPlugin; beautiful-mermaid and lucide-react pinned to exact versions | user-approved-plan | accepted |
| D-0114 | No docs landing page: / redirects to /docs | user-approved-plan | accepted |
| D-0115 | Docs audience rule: Framework/Core/CLI/SDK explain usage; architecture, quality, contributing and decisions live in Internal | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Where decisions live.** The owner provided the ADR system guide: branch ADRs, a TOML index,
  templates, a helper, archiving. Adopted, with decision IDs and provenance added.
- **Enforcement level.** The options were instructions only, instructions plus CI, or instructions
  plus automated checks including hooks. The owner chose instructions plus automated checks.
- **Backfill.** All past decisions are recorded with provenance; agent-made ones are flagged
  `needs-review`.

### Rationale
Agents lose context between sessions. A machine-queryable index plus docs rendered from the same
files gives one source of truth. Hooks make the plan rule hard to bypass by accident.

### Implementation choices approved in the follow-up plan (D-0101 to D-0106)
These were chosen by the agent during implementation, then listed and approved in a re-approval
plan (needed because the plan gate was installed after the first approval).
- **D-0101.** `/decisions` sits next to `/docs` instead of being merged into the docs page tree.
  The ADR tree (branches and merged months) differs from the docs tree. A generated index gives
  every decision a stable anchor that docs can link to.
- **D-0102.** Exact versions for the docs devDependencies, like every other package; only peers
  use ranges.
- **D-0103.** `launch.json` holds absolute machine paths, so it stays local, as the plan's
  `.gitignore` rule intended.
- **D-0104.** The Stop hook checks the branch, not the last edit: one ADR per unit of work.
- **D-0105.** Building the docs once per CI run is enough, since they don't depend on the OS or
  Node matrix.
- **D-0106.** `prepare` runs on `pnpm install`, so the hook is on by default. It no-ops in
  tarballs or other non-git trees.

### Trade-offs Accepted
- The Bash write detection in the hook is a heuristic.
- `SKIP_DOCS_CHECK` exists for humans only.

## Roadmap decisions recorded here (not yet implemented)
These were decided during V1 planning and are kept here so M3–M5 plans start from them: D-0068,
D-0069, D-0070, D-0071, D-0072, D-0073, D-0074, D-0075 (indexed under `feat/m1-foundations`).

## Implementation
`.claude/` (guide, index, helper, templates, ADRs, skills, hooks), `apps/docs` (Fumadocs),
`CLAUDE.md`, `scripts/check-docs-adr.mjs`, `.githooks/`, CI steps.

## Investigation Notes
- Fumadocs 16 setup was taken from the official `create-fumadocs-app` template
  (`+next+fuma-docs-mdx`): `defineDocs` from `fumadocs-mdx/macro`, `loader` from
  `fumadocs-core/source`, `createMDX()` in `next.config.mjs`. The macro's `dir` accepts a path
  outside the app (`../../.claude`), which lets the ADRs render without copies (D-0099).
- The decisions collection uses `files` patterns to exclude `templates/` (their frontmatter holds
  `{{placeholders}}`).
- Search uses `createSearchAPI('advanced')` over both loaders, so ADRs are searchable too.
- `/decisions` is generated from `adr-index.toml` (smol-toml), with one anchor per decision ID, so
  docs link decisions as `/decisions#D-NNNN`. Superseded by D-0108: the index is now
  `/docs/internal/decisions`.

### Front-facing restructure (D-0107 to D-0115)
- The owner asked for front-facing docs for new developers, organized like fumadocs.dev. The
  roots are Framework, Core, CLI, SDK and Internal, shown as Layout Tabs (dropdown).
  - The adapters are a section of Core, because they are part of the core config.
  - `@puck-remote/next` is documented in Framework.
- `loader()` accepts a record of sources. The ADR source is remounted under `internal/decisions`
  with `update(source).page(...).meta(...)`.
  - `.files(...)` was tried first. It widens the page type to a page/meta union and breaks
    `page.data.body` typing.
  - A `meta.json` from the docs source (`internal/decisions/meta.json`) orders the folder that
    holds the ADR files of the other source.
- `source.config.ts` adds `remarkMdxMermaid` and `remarkMdxFiles` globally. Defaults such as
  remark-npm stay on. The macro collections pick the file up automatically.
- beautiful-mermaid 1.1.3 supports flowchart, state, sequence, class, ER and XY charts. It renders
  on the server with `var(--color-fd-*)` colors, so diagrams follow light and dark mode.
- `lucide-react` was pinned at 1.52.0 (latest at install time), per D-0113.
- YAML pitfall: a frontmatter `description` that contains `: ` must be quoted.
- A `files` code block takes every token after the tree drawing as part of the file name.
  Descriptions therefore go in a table next to the tree.

## Challenges & Solutions
- WebFetch would not return Fumadocs code verbatim; the template was read from the npm tarball
  instead.
- Docs dev dependencies were pinned to exact versions to follow the repository's existing
  convention (only peer dependencies use ranges).

## Impact Assessment
Every future change requires a plan, an ADR entry and a docs update.

## Quality Assurance
- After the restructure:
  - `pnpm docs:build` gives 84 pages.
  - The link script found 0 broken `/docs` links, 0 missing `<Source>` paths and 0 old
    `/decisions` links.
  - Browser checks:
    - the dropdown lists the 5 roots, and each sidebar shows only its root;
    - TypeTable, `files` trees, npm tabs, Steps and tabbed code blocks render;
    - a sequence diagram renders in light mode and a flowchart in dark mode;
    - a search for "nonce" hits both docs and ADRs;
    - `/docs/internal/decisions` shows 7 ADRs and 115 decision rows.
- `pnpm adr check` passes.
- `pnpm docs:build`: 63 pages (before the restructure).
- Browser check (port 3200): pages render; a search for "nonce" returns docs and ADR pages;
  `/decisions` lists all ADRs and every decision row.
- Internal `/docs/...` links and `<Source>` paths were checked by a script; none are broken.
- Hooks, fed JSON:
  - Edits, `git commit`, `rm`, `sed -i` and redirects into the repo are blocked without the
    marker and allowed with it.
  - Reads, `pnpm test`, and redirects to `/dev/null` or outside the repo are always allowed.
  - Stop blocks code changes that lack docs or an ADR change. It allows them when both are present,
    and when `stop_hook_active` is set.
  - In this session, the edit hook really blocked an ADR edit until the re-approval plan passed
    ExitPlanMode.
- `scripts/check-docs-adr.mjs`, on scratch commits in a throwaway worktree (worktree and branch
  removed afterwards):

  | Case | Result |
  |---|---|
  | Code only | fail |
  | `SKIP_DOCS_CHECK=1` | pass |
  | Code + docs | fail |
  | Code + docs + ADR | pass |
  | `--base` (CI mode) | pass |
  | Test-only change, no ADR | fail |

- `pnpm test` (115 passed, 1 skipped: the Linux-only bubblewrap test), `pnpm typecheck` and
  `pnpm lint:pkg` pass.

## Outcome & Lessons
- Installing a plan gate in the middle of a session leaves the earlier approval without a marker.
  The fix is a new plan approval, not a manual marker.
- `apps/host/.next/types` can go stale after routes are removed; `next typegen` regenerates it.
- **Pending for the human:**
  - review the 23 `needs-review` decisions (`pnpm adr list --needs-review`);
  - merge this branch;
  - then run `pnpm adr archive docs/fumadocs-and-adr-system`.

## Tags
docs adr process agents enforcement
