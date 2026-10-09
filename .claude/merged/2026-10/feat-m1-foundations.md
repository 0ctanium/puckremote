---
title: "M1: foundations (contracts, auth, packaging, CI)"
description: V1 roadmap answers plus milestone 1 — ArtifactStore, CacheStore and AuthAdapter contracts, auth + CSRF, adapter contract test kits, tsdown packaging, CI and changesets.
---

# Branch ADR: feat/m1-foundations

## Meta
- **Branch**: feat/m1-foundations (backfilled; commits 5772629, 00cdc42 on `main`)
- **Type**: feat
- **Created**: 2026-10-08
- **Status**: Merged
- **Author**: Claude
- **Approved by**: project owner (roadmap answers and the approved M1 plan)
- **PR**: none

## Problem Statement
### Context
The owner asked what was missing for a publishable V1. Their answers set the constraints:
- untrusted theme developers (a marketplace is possible later);
- a self-hosted library, usable on distributed systems;
- Payload as the first backend;
- everything agnostic, through adapters.

The work was split into milestones M1–M5. This ADR covers the roadmap decisions and M1.

### Goals
- Pluggable artifact storage and cache, mandatory authentication, CSRF protection.
- Publishable packages, CI.

### Non-Goals (for M1)
Worker isolation (M2), the content lifecycle and Payload (M3), editor features (M4), developer
experience and ops (M5).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0052 | Theme authors are untrusted (marketplace possible later) | user | accepted |
| D-0053 | puck-remote is a self-hosted library usable by anyone, including on distributed systems | user | accepted |
| D-0054 | Payload is the first real backend | user | accepted |
| D-0055 | Split V1 into milestones M1–M5, each with its own approved plan | user-approved-plan | accepted |
| D-0056 | AuthAdapter contract based on the standard Request (authenticate + authorize per action); auth required in production; devAllowAll for dev | user-approved-plan | superseded by D-0187 |
| D-0057 | CSRF: mutations need the x-puck-remote header and an own/allowlisted Origin (Sec-Fetch-Site honored) | user-approved-plan | superseded by D-0187 |
| D-0058 | Pluggable ArtifactStore; default fs adapter; change detection via store watch or polling | user | superseded by D-0197 |
| D-0059 | Pluggable CacheStore; default in-memory (globalThis) implementation | user | superseded by D-0187 |
| D-0060 | Packages built with tsdown (ESM + d.ts), peer dependencies, CI matrix (Linux x64/arm64, macOS arm64 × Node 24/26) | user | accepted |
| D-0061 | License: MIT | user-approved-plan | accepted |
| D-0062 | @puck-remote/source export condition: workspace tests/typecheck use sources, apps use dist | user-approved-plan | accepted |
| D-0063 | Changesets with all @puck-remote/* packages in one fixed version group | agent-unreviewed | needs-review |
| D-0064 | Built-in auth helpers: devAllowAll (throws in production) and sharedSecretAuth (bearer or cookie) | user-approved-plan | superseded by D-0187 |
| D-0065 | Artifact pointer polling default 2000 ms when the store has no change feed | user-approved-plan | accepted |
| D-0066 | memoryCache keeps at most 10 000 entries (oldest evicted); shared-cache errors are treated as misses | agent-unreviewed | superseded by D-0187 |
| D-0067 | Adapter contract test suites exported from @puck-remote/core/testing | user-approved-plan | accepted |
| D-0068 | Content migrations: block version + migrations run in the isolate, items carry props.__v, build fails on field changes without a bump (planned M3) | user-approved-plan | superseded by D-0188 |
| D-0069 | Publishing workflow (drafts, publish, history, conflicts, preview links) lives in the PageStore contract (planned M3) | user | superseded by D-0188 |
| D-0070 | Caching semantics (tags, invalidation events) in the core; bindings apply them (Next revalidateTag, CDN headers) (planned M3) | user-approved-plan | superseded by D-0149 |
| D-0071 | Richtext, inline editing and extensible, typed host fields are mandatory for V1 (planned M4) | user | accepted |
| D-0072 | Dependent ($ref) queries are post-V1; depth covers nested relations | user-approved-plan | accepted |
| D-0073 | Localization is post-V1; locale detection is app-defined via a LocaleResolver (cookie, sub-path, domain…); V1 keeps locale-ready keys | user | accepted |
| D-0074 | A `puck-remote dev` command is in scope (M5); create-theme scaffolding is not for now | user | accepted |
| D-0075 | Remote renderer service planned for M5 (only the RenderRuntime interface lands in M2) | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Enforcement of the plan rule.** Not applicable yet; it arrived later in
  `docs/fumadocs-and-adr-system`.
- **Auth design (D-0056).** Framework-specific middleware, or a `Request`-based contract. The
  contract was chosen: `authenticate(request)` plus `authorize(principal, action, resource)`. It
  works with Payload, cookies or tokens in any framework.
- **CSRF (D-0057).** The custom `x-puck-remote` header forces a CORS preflight, which is never
  granted. On top of that, `Origin` must be the request's own origin or an allowlisted one, and
  `Sec-Fetch-Site` is honored.
- **Source condition (D-0062).** The `@puck-remote/source` export condition lets the workspace's
  tests and typecheck run on sources, while apps and consumers use `dist`.

### Rationale
Contracts live in `@puck-remote/sdk/host`, next to `DataSource` and `PageStore`, so adapter authors
never depend on the heavy core.

### Trade-offs Accepted
Locally, packages must be built (`pnpm build` or `pnpm dev`) before the app or CLI runs.

## Implementation
- `artifacts-fs`; `ArtifactLoader` reading through the store (watch or polling).
- `memoryCache()`.
- `auth.ts` (`devAllowAll`, `sharedSecretAuth`, `authorizeRequest`, `checkCsrf`).
- `core/testing` contract suites.
- tsdown builds, exports maps, peer dependencies, LICENSE.
- changesets; CI and release workflows.

## Investigation Notes
- `publint` and `attw` are clean.
- `'use client'` must be re-added as a banner on the editor entry, because bundling drops
  module-level directives.

## Challenges & Solutions
pnpm pack needed a `version` on the private `mock-api` package.

## Impact Assessment
Closed the hole where draft data could be read without authentication.

## Quality Assurance
78 tests (auth, CSRF, contract kits, polling); live production checks (401, 403, 404, artifact
switch).

## Outcome & Lessons
The adapter-everything approach generalizes cleanly. Roadmap decisions that are not yet
implemented are listed here, so that M3–M5 plans start from them.

## Tags
roadmap auth csrf artifacts cache packaging ci
