---
title: Pluggable host data source and page store
description: Replace the hard-coded "payload" mock with trusted, backend-agnostic DataSource and PageStore plugins whose policy is enforced by the host core; type theme queries from the source.
---

# Branch ADR: feat/pluggable-data-source

## Meta
- **Branch**: feat/pluggable-data-source (backfilled; commit 1dc6604 on `main`)
- **Type**: feat
- **Created**: 2026-10-07
- **Status**: Merged
- **Author**: Claude
- **Approved by**: project owner (direction and answers; no formal plan for this step)
- **PR**: none

## Problem Statement
### Context
The POC hard-coded a "payload" source. The owner clarified two things. First, theme `defineAdapter`
stays untrusted and sandboxed. Second, the *host's* data access must be modular, so hosts can plug
in any database or framework (Payload, Mongo, SQL…). The adapter should receive the declarative
QuerySpec directly and declare, per collection, what is fetchable and how.

### Goals
- A backend-agnostic data source contract, with per-collection policy, enforced by the host.
- Theme `find` / `findByID` / `global` typed from the source type.
- Page storage pluggable as well.

### Non-Goals
A real Payload adapter (planned for M3).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0034 | Theme defineAdapter stays untrusted and runs in the isolate | user | accepted |
| D-0035 | Host data access is a pluggable, trusted DataSource contract (in the SDK host entry) so hosts can plug any DB/framework | user | accepted |
| D-0036 | Each collection declares its policy (fields, filters, sort, limits, depth, tags); the host core enforces it and the plugin receives a normalized query | user | accepted |
| D-0037 | Theme queries typed via Register module augmentation plus source<S>() (find<Adapter>() is impossible without partial inference) | agent-unreviewed | needs-review |
| D-0038 | Populated relations are projected with the target collection policy; depth clamped to maxDepth | agent-unreviewed | needs-review |
| D-0039 | Page storage is a pluggable PageStore; concrete plugins are wired only in the app config | user | superseded by D-0188 |
| D-0040 | Example plugins as separate packages: source-mock (in-memory CMS) and pages-fs (JSON files) | agent-unreviewed | superseded by D-0188 |
| D-0041 | QuerySpec source renamed payload → host; sdkMajor bumped 0 → 1 (older artifacts rejected) | agent-unreviewed | needs-review |
| D-0042 | Draft results are never cached; the source change feed invalidates cache tags | agent-unreviewed | superseded by D-0187 |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Where enforcement lives (D-0036).** Either each plugin enforces its own rules, or the host core
  enforces them from a declared policy. The host core was chosen: it validates fields and operators
  against the policy, clamps limits and depth, and projects the output. Plugins only translate a
  normalized query.
- **Typing (D-0037).** The owner asked for `find<Adapter>('posts')`. TypeScript has no partial
  generic inference, so an explicit first generic would stop `'posts'` being inferred. The
  implementation offers `Register` module augmentation (zero generics) plus `source<S>()`. **Needs
  review**: it was chosen by the agent and reported, but not explicitly approved.

### Rationale
Policy-in-core means a careless plugin cannot widen what themes see. Relation population is
projected with the *target* collection's policy (D-0038), so hidden fields such as author emails
never leak through relations.

### Trade-offs Accepted
The `source: 'payload'` → `'host'` rename was a breaking manifest change, so `sdkMajor` was bumped
to 1 (D-0041) and older artifacts were rejected.

## Implementation
- `@poc/sdk/host` (now `@puck-remote/sdk/host`): `defineDataSource`, `defineCollection<D>()`,
  `defineGlobal<D>()`, `NormalizedFind`, `PageStore`.
- `HostSource` enforcement in core (`packages/core/src/server/query/host-source.ts`).
- Example plugins: `source-mock` and `pages-fs`. Wired only in the app's config.

## Investigation Notes
TypeScript cannot infer the collection name once one generic is explicit; hence the
`Register` / `source<S>()` approach.

## Challenges & Solutions
Old artifacts (v1, v2) became invalid. The host now rejects them with an explicit "incompatible SDK
major" message.

## Impact Assessment
Security improves: field allowlists, operator allowlists, limit and depth clamps, and output
projection are centralized.

## Quality Assurance
Test 13 was rewritten (policy enforcement, relations, change-feed invalidation), and theme type
tests were added (`examples/theme/type-tests.ts`).

## Outcome & Lessons
Contracts in the SDK, enforcement in the core, and implementations in plugins became the pattern
for every later adapter.

## Tags
data-source adapters typing security page-store
