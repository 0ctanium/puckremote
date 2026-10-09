---
title: "Origin-based routing: editor at /, admin pages at the admin origin root"
description: "Origin-based routing: editor at /, admin pages at the admin origin root"
---

# Branch ADR: feat/origin-routing

## Meta
- **Branch**: feat/origin-routing
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
The editor was reached at `editor.example.com/editor`, and the proxy rewrote every editor-origin path under the editor route. Admin pages lived at `admin.example.com/admin/…`.

### Goals
Clean URLs per origin. The editor page is at the editor origin's root, and everything else there is 404 except Next's files. Admin pages are at the admin origin's root, and stay hidden on other origins.

### Non-Goals
Redirects (rewrites only); an `/admin` index page in the example; fixing the owner's admin layout.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0282 | Editor origin: only / serves the editor page (rewrite to routes.editor); every other path, /editor included, is 404; /_next/* passes through | user | accepted |
| D-0283 | Host (admin) origins: every path is rewritten under the admin route; that route is 404 on other origins | user | accepted |
| D-0284 | New routes.admin (default '/admin'); the rewrite is always on when origins are set | user-approved-plan | accepted |
| D-0285 | On host origins routes.theme and /_next/* are never rewritten | user-approved-plan | accepted |
| D-0286 | Proxy 404s are plain-text Not found with cache-control no-store and the surface security headers | user-approved-plan | accepted |
| D-0287 | Editor-origin 404s carry the editor CSP headers | user-approved-plan | accepted |
| D-0288 | Example app: no code change (EDITOR_URL already the editor root); CLAUDE.md, README and quick-start URLs updated; owner admin layout bug left untouched | user-approved-plan | accepted |
| D-0289 | Proxy tests in packages/next/test/proxy.test.ts with vitest 5.0.3 as a dev dependency of @puck-remote/next; browser check | user-approved-plan | accepted |
| D-0290 | Origin routing on feat/origin-routing from chore/examples-layout | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Admin mapping: rewrite every path (chosen) / redirect the root to `/admin`.
- Old `/editor` URL on the editor origin: 404 (chosen) / 308 to `/`.

### Rationale
Rewrites keep `/admin` out of the visible URLs, using the same mechanism as the editor origin. Answering 404 for every other path keeps the editor origin minimal.

### Trade-offs Accepted
- `admin.example.com/admin/x` becomes `/admin/admin/x` (normally 404).
- An app that wants other routes on its admin origin must put them under `routes.admin`.

## Implementation
### Public API / config changes
`routes.admin` (default `'/admin'`). The `createProxy` behavior changes per D-0282 and D-0283.

### Docs pages touched
next-js/api and index, concepts/origins, configuration, quick-start, quality/testing; also CLAUDE.md and README.

- `packages/next/src/proxy.ts` and `packages/core/src/server/config.ts`.
- New `packages/next/test/proxy.test.ts` (8 tests) and vitest in `@puck-remote/next`.
- Checked with curl on the example app:
  - `127.0.0.1:3100/` 200; `/editor` and `/foo` 404;
  - `admin.localhost:3100/editor` renders `/admin/editor` (500 from the owner's layout); `/` 404 (the app has no `/admin` page);
  - `localhost:3100/admin/editor` and `/editor` 404;
  - `admin.localhost:3100/cdn/bundle.browser.js?v=…` 200.
- The editor page loads all 26 `/_next` chunks.

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
[Technical and process challenges encountered]

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
[Tests, results, review notes]

## Outcome & Lessons
[Final results and lessons learned]

## Tags
next origins routing
