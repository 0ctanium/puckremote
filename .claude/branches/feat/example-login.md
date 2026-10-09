---
title: "Demo login for the example app's admin"
description: "Demo login for the example app's admin"
---

# Branch ADR: feat/example-login

## Meta
- **Branch**: feat/example-login
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
Since M3a the example app's admin page and server actions had no auth (D-0240); the docs only said real apps must add a session check.

### Goals
Show the protection again with a minimal login: admin/admin, a signed session cookie checked by every admin page and server action.

### Non-Goals
A user store, password hashing, CSRF tokens (SameSite=Strict and Next's server-action origin check cover the demo), session revocation, auth in the core or the Next bindings.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0291 | Example login credentials hard-coded admin/admin (timingSafeEqual), demo only | user | accepted |
| D-0292 | Example session: stateless HMAC-signed cookie, no dependency | user | accepted |
| D-0293 | Fix (app)/admin/layout.tsx to a default export (nothing else changed) | user | accepted |
| D-0294 | Token base64url(JSON {u, exp}).base64url(HMAC-SHA256), timingSafeEqual, 8 h expiry checked server-side | user-approved-plan | accepted |
| D-0295 | Cookie admin_session: HttpOnly, SameSite=Strict, Path=/, host-only (no Domain), Secure in production, Max-Age 8 h | user-approved-plan | accepted |
| D-0296 | ADMIN_SESSION_SECRET env; fixed dev fallback; production without it fails closed | user-approved-plan | accepted |
| D-0297 | examples/app/src/auth.ts (createSession, getSession, requireSession) called by every admin page (redirect /login) and server action (throw unauthorized); proxy unchanged | user-approved-plan | accepted |
| D-0298 | Login page/actions under (app)/admin/login, /admin redirects to /editor, logout button in the admin header, logged-in /login redirects to /editor | user-approved-plan | accepted |
| D-0299 | Example login verified in the browser and with curl (no new test runner) | user-approved-plan | accepted |
| D-0300 | Docs: environment, quick-start, threat-model, deploying, docs map; credentials stated as demo-only | user-approved-plan | accepted |
| D-0301 | Example app: server actions (resolveData, publish) and a ClientEditor; demo login (admin/admin, signed session cookie) protects admin pages and actions; host origin admin.localhost:3100; the editor page renders <PuckRemoteEditor> with a header badge override | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Session: HMAC-signed cookie (chosen; no dependency, survives restarts) / JWT with jose (one more dependency) / in-memory store (revocable, lost on restart).
- Layout: fix the owner's named export (chosen) / place login outside it.

### Rationale
A stateless signed cookie is the smallest thing that shows the real requirements: host-only, HttpOnly, SameSite, expiry, and a check in every action.

### Trade-offs Accepted
- Logout only deletes the cookie; a copied token stays valid until it expires (8 h).
- The credentials are hard-coded (demo only).

## Implementation
### Public API / config changes
Example app only: env `ADMIN_SESSION_SECRET` (required in production); routes `/login` and `/` on the admin origin.

### Docs pages touched
environment, quick-start, guides/deploying, internal/architecture/threat-model, internal/contributing/docs; README.

- `examples/app/src/auth.ts`; `(app)/admin/{layout.tsx (default export), page.tsx, login/page.tsx, login/actions.ts}`; guards in `editor/page.tsx` and `editor/actions.ts`; a logout button in `ClientEditor.tsx`.
- Verified with the browser and curl:
  - redirects to `/login` without a session, or with a tampered or expired cookie;
  - a wrong password shows the error;
  - admin/admin logs in and the editor loads;
  - the cookie has `HttpOnly; SameSite=strict; Path=/; Max-Age=28800` and no `Domain`;
  - `resolveData` and `publish` called directly answer `unauthorized` without a session, and run with one;
  - logout returns to `/login` and the editor redirects again;
  - `/login` while logged in redirects to `/editor`.

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
examples security auth
