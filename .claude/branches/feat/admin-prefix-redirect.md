---
title: "Redirect /admin/x to /x on admin origins"
description: "Redirect /admin/x to /x on admin origins"
---

# Branch ADR: feat/admin-prefix-redirect

## Meta
- **Branch**: feat/admin-prefix-redirect
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
On admin origins every path is rewritten under `/admin` (D-0283), so the old admin URL `admin.localhost:3100/admin` (in docs and browser history) became `/admin/admin` and returned 404.

### Goals
Old `/admin/x` links on admin origins land on `/x`.

### Non-Goals
Redirects on other origins (they keep answering 404).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0307 | Host (admin) origins: every path is rewritten under the admin route, except that paths already under it (/admin, /admin/x) redirect to the path without the prefix; that route is 404 on other origins | user | accepted |
| D-0308 | The /admin prefix redirect is a 307 (temporary), not a cached 308 | user-approved-plan | accepted |
| D-0309 | The prefix redirect keeps the query string, is same-origin, and carries the admin security headers and cache-control no-store | user-approved-plan | accepted |
| D-0310 | The theme-route exemption is unchanged; the redirect is checked before the rewrite | user-approved-plan | accepted |
| D-0311 | Prefix redirect tests in packages/next/test/proxy.test.ts plus a curl check | user-approved-plan | accepted |
| D-0312 | Docs for the prefix redirect: next-js/api, concepts/origins, configuration | user-approved-plan | accepted |
| D-0313 | Prefix redirect on feat/admin-prefix-redirect from feat/admin-index | user-approved-plan | accepted |
| D-0314 | Admin layout (owner's design): sidebar with Dashboard/Editor links, the signed-in user and a Log out button (Puck Button), globals.css; the dashboard drops its own user line and logout | user | accepted |
| D-0315 | The sidebar user block only reads the session (getSession, renders nothing when logged out) because the layout also wraps /login; every admin page keeps its own requireSession(), the dashboard included | user | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
307 temporary (chosen) / 308 permanent (cached indefinitely by browsers).

### Rationale
A cached permanent redirect can stick around while the routing changes; admin pages don't need SEO.

### Trade-offs Accepted
Routes literally named `/admin/...` under the admin prefix (i.e. `/admin/admin/...`) are unreachable on admin origins.

## Implementation
### Public API / config changes
`createProxy` behavior only.

### Docs pages touched
next-js/api, concepts/origins, configuration.

- `packages/next/src/proxy.ts`: the redirect is built on the addressed origin (`requestOrigin`), not `nextUrl`.
- `packages/next/test/proxy.test.ts`: 9 tests.
- curl: `/admin` → 307 `http://admin.localhost:3100/`; `/admin/editor?x=1` → 307 `/editor?x=1`; `/` and `/editor` unchanged.

## Follow-up: admin sidebar (owner's changes)
The owner added an admin layout with a sidebar, `globals.css` and a Puck-styled logout button. As
first written, it put `requireSession()` in the sidebar and removed it from the dashboard, which
caused two problems:
- `/login` redirected to itself, because the layout wraps it;
- the dashboard streamed the theme id before the client-side redirect.

With the owner's approval, the sidebar now uses `getSession()` (display only) and the dashboard
calls `requireSession()` again. Verified with curl: logged-out `/login` 200 with no redirect,
logged-out `/` 307 to `/login` with no theme id, logged-in `/` shows the user, the theme and Log
out.

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
