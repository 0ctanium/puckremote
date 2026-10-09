---
title: "Admin index page (dashboard) in the example app"
description: "Admin index page (dashboard) in the example app"
---

# Branch ADR: feat/admin-index

## Meta
- **Branch**: feat/admin-index
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
`admin.localhost:3100/` (served by `/admin`) only redirected to `/editor` (D-0298).

### Goals
A simple admin dashboard at the admin origin's root.

### Non-Goals
Listing pages, creating pages, per-page editor routes.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0302 | Login page/actions under (app)/admin/login; /admin is a simple dashboard (signed-in user, current theme id, editor link, Log out; no page list or creation); logout button in the admin header; logged-in /login redirects to /editor | user | accepted |
| D-0303 | Dashboard is a server component calling requireSession(), reading the pointer via artifacts.readPointer() (none published shown), inline styles, force-dynamic, reusing the logout action | user-approved-plan | accepted |
| D-0304 | After login users still land on /editor | user-approved-plan | accepted |
| D-0305 | Docs: quick-start dashboard row, environment login paragraph | user-approved-plan | accepted |
| D-0306 | Admin index on feat/admin-index from feat/example-login | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
Page list with edit links (needs a catch-all `/editor/<slug>` route) / simple dashboard (chosen).

### Rationale
The owner chose the smallest useful page; it needs no routing change.

### Trade-offs Accepted
The editor still edits only the home page from the admin UI.

## Implementation
### Public API / config changes
None (example app only).

### Docs pages touched
quick-start, environment.

- `examples/app/src/app/(app)/admin/page.tsx`.
- Verified: no session → 307 `/login`; with a session the page shows the user, theme `7894f1e63275`, the editor link and Log out; the link opens `/editor`; Log out lands on `/login`.

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
examples
