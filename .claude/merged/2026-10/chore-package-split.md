---
title: "Package split: framework-agnostic core + Next bindings"
description: Move all host logic out of the Next app into @core (engine) and @next (thin bindings), keep the SDK as a separate thin bridge, and reduce the app to wiring.
---

# Branch ADR: chore/package-split

## Meta
- **Branch**: chore/package-split (backfilled; commit 9af95f1 on `main`)
- **Type**: chore
- **Created**: 2026-10-08
- **Status**: Merged
- **Author**: Claude
- **Approved by**: project owner (approved plan)
- **PR**: none

## Problem Statement
### Context
All host logic lived in `apps/host/src`. The owner wanted the system shipped as packages, so that a
Next app only needs a few thin files. They also wanted core features split from Next-specific code,
and asked whether the core should merge into the SDK.

### Goals
- A reusable, framework-agnostic engine.
- Thin Next bindings.
- An app of about 80 lines.

### Non-Goals
Bindings for other frameworks (the fetch-style handlers make them possible).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0043 | Keep @sdk separate and thin (bundled into themes); the engine is a separate package | user-approved-plan | accepted |
| D-0044 | Split into a framework-agnostic core and thin Next.js bindings | user | accepted |
| D-0045 | App reduced to wiring: proxy, public catch-all page, editor page, api/[[...path]], theme/[[...path]] | user | accepted |
| D-0046 | Theme files served at /theme/v<N>/assets/** (and bundle at /theme/v<N>/bundle.js, later removed) | user-approved-plan | superseded by D-0262 |
| D-0047 | createCore memoized on globalThis by config.id so all route bundles share one runtime | user-approved-plan | accepted |
| D-0048 | App config resolves data paths from process.cwd() (import.meta.dirname is undefined in Next server bundles) | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **SDK and core merged or separate (D-0043).** The SDK is bundled into untrusted theme code. The
  core needs isolated-vm, zod, undici and Puck's editor. The audiences and trust levels differ, and
  `sdkMajor` should version only the small bridge. Kept separate.
- **App files (D-0045).** These were requested by the owner: `proxy.ts`, `[[...path]]/page.tsx`,
  `editor/[[...path]]/page.tsx`, `api/[[...path]]/route.ts` and `theme/[[...path]]/route.ts`.

### Rationale
Fetch-style `handleApi` / `handleTheme` (Request → Response) keep the core free of framework code.
The `globalThis` memo per `config.id` (D-0047) makes every Next route bundle share one runtime.

### Trade-offs Accepted
The theme URLs changed to `/theme/v<N>/…` (D-0046).

## Implementation
- `packages/core`: `createCore`, `react/` (`PuckRemotePage`), `editor/`, `edge` / `cacheability`.
- `packages/next`: `createPuckRemote`, `createProxy`, `withPuckRemote`.

## Investigation Notes
`import.meta.dirname` is undefined inside Next server bundles, so the app resolves data paths from
`process.cwd()` (D-0048).

## Challenges & Solutions
Stale `@poc` symlinks were removed after the rename (see `chore/rename-puck-remote`).

## Impact Assessment
No behaviour change for themes.

## Quality Assurance
All tests, `next build`, live checks of every route.

## Outcome & Lessons
The app shrank to wiring. Package boundaries are enforced by `no-dev-code.test.ts`.

## Tags
packaging architecture next core
