---
title: "Example app, data and mock API under examples/app"
description: "Example app, data and mock API under examples/app"
---

# Branch ADR: chore/examples-layout

## Meta
- **Branch**: chore/examples-layout
- **Type**: chore
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
The example app (`apps/host`), its CMS seed (`data/`), its published artifacts (`artifacts/`) and the mock API (`mock/api-server`) were spread across the repository root.

### Goals
Everything the example app owns lives under `examples/app`, next to `examples/theme`; `apps/` holds only the docs.

### Non-Goals
Renaming packages; fixing the owner's in-progress admin layout (it still answers 500).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0273 | Layout: apps/host → examples/app; data/cms.json → examples/app/data/cms.json; artifacts/ → examples/app/data/artifacts/; mock/api-server → examples/app/mock/api-server | user | accepted |
| D-0274 | The owner's staged apps/host restructure (route groups) is committed with the move as-is; the artifacts-fs change stays out | user | accepted |
| D-0275 | Package names host and mock-api stay | user | accepted |
| D-0276 | pnpm-workspace: mock/* replaced by examples/app/mock/*; mock-api stays its own package | user-approved-plan | accepted |
| D-0277 | PUCK_REMOTE_ROOT keeps its name; default is the app dir (cwd); data at <root>/data/artifacts and <root>/data/cms.json | user-approved-plan | accepted |
| D-0278 | Example theme scripts publish/release/pull use --artifacts ../app/data/artifacts | user-approved-plan | accepted |
| D-0279 | git mv tracked files; .gitignore examples/app/data/artifacts/* (+ .gitkeep); local artifacts moved with mv; empty old folders removed | user-approved-plan | accepted |
| D-0280 | Code and test references updated: core tests, no-dev-code app roots, bench, check-docs-adr code roots, local launch.json | user-approved-plan | accepted |
| D-0281 | Docs and CLAUDE.md/README updated to the new paths; generic adapter snippets unchanged | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Owner's restructure: wait for a clean tree / include it (chosen) / move it uncommitted.
- Package names: keep `host` and `mock-api` (chosen) / rename to match the folders.

### Rationale
- Keeping the names means commands, CI and `.changeset` don't change.
- `PUCK_REMOTE_ROOT` defaulting to the app directory makes the example self-contained.

### Trade-offs Accepted
Edits to `examples/app/data/cms.json` now count as code for the docs/ADR check, since everything under `examples/` does.

## Implementation
- `git mv` of the app, the CMS seed, `.gitkeep` and the mock API; local artifacts moved with `mv`.
- Updated `pnpm-workspace.yaml`, `.gitignore`, the example app config, the theme scripts, core tests (helpers, routes, worker, no-dev-code), bench, `scripts/check-docs-adr.mjs`, the local launch.json, CLAUDE.md and the docs (environment, quick-start, next-js, packaging, contributing, editor-lifecycle sources).
- Checks: tests, typecheck, lint:pkg and docs:build pass. The theme publishes into `examples/app/data/artifacts`. The public site renders with CMS and mock API data. The admin page still returns 500 because of the owner's layout without a default export.

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
[Technical and process challenges encountered]

## Impact Assessment
[Chores still change behaviour somewhere: list it]

[Performance, user, maintenance, security]

## Quality Assurance
[Tests, results, review notes]

## Outcome & Lessons
[Final results and lessons learned]

## Tags
examples layout
