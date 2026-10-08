---
title: Rename @poc to @puck-remote
description: Rename every package, binary, API name, env var and internal key from "poc" to "puck-remote".
---

# Branch ADR: chore/rename-puck-remote

## Meta
- **Branch**: chore/rename-puck-remote (backfilled; commit 7886ef5 on `main`)
- **Type**: chore
- **Created**: 2026-10-08
- **Status**: Merged
- **Author**: Claude
- **Approved by**: project owner (requested the rename; specific API names were not explicitly approved)
- **PR**: none

## Problem Statement
### Context
The owner asked to rename "the whole poc thing" to the `@puck-remote` package scope.

### Goals
Consistent naming across packages, CLI, APIs, env vars, log prefixes and globalThis keys.

### Non-Goals
Renaming the repository folder, or prose where "POC" means proof of concept.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0049 | Package scope @puck-remote (sdk, cli, core, next, source-mock, pages-fs); CLI binary puck-remote | user | accepted |
| D-0050 | API names: defineConfig, PuckRemoteConfig, createCore/PuckRemoteCore, createPuckRemote/PuckRemote, withPuckRemote, PuckRemotePage, app instance `remote` | agent-unreviewed | needs-review |
| D-0051 | Keep "POC" prose, the demo site name and the repository folder name unchanged | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
The new API names (D-0050) were chosen by the agent and reported afterwards. **They need review**:
`defineConfig`, `PuckRemoteConfig`, `createCore` / `PuckRemoteCore`, `createPuckRemote` /
`PuckRemote`, `withPuckRemote`, `PuckRemotePage`, and the app instance named `remote`.

### Rationale
Short names where a package already namespaces them (`createCore` from `@puck-remote/core`), and
product-prefixed names where they appear in app code.

### Trade-offs Accepted
`sdkMajor` was unchanged: no manifest or wire change.

## Implementation
Ordered regex rename rules across the tracked files; stale `@poc` symlinks were removed afterwards.

## Investigation Notes
pnpm left stale `@poc` links in `node_modules`, which could have masked a missed rename. They were
removed, and the tests and typecheck were re-run.

## Challenges & Solutions
None beyond the stale links.

## Impact Assessment
Breaking for any external user (none at that time).

## Quality Assurance
58 tests, typecheck, `next build`, live checks.

## Outcome & Lessons
Theme v4 was published with the renamed CLI.

## Tags
naming packaging
