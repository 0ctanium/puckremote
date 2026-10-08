---
title: "M2: isolation (worker pool, server-rendered editor, origins, CSP)"
description: Run theme code in permission-restricted worker processes, render the editor on the server, separate site and editor origins, and add CSP/security headers.
---

# Branch ADR: feat/m2-isolation

## Meta
- **Branch**: feat/m2-isolation (backfilled; commits 0d379f5…816d06c on `main`)
- **Type**: feat
- **Created**: 2026-10-08
- **Status**: Merged
- **Author**: Claude
- **Approved by**: project owner (approved M2 plan)
- **PR**: none

## Problem Statement
### Context
Themes are untrusted. Three gaps remained:
1. isolated-vm ran inside the host process.
2. The editor ran theme JavaScript on the admin origin.
3. The site and editor shared an origin.

### Goals
Layered isolation with clear, tested guarantees, and honest limits.

### Non-Goals
A remote renderer (only its interface lands here; the implementation is planned for M5).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0076 | RenderRuntime abstraction (session/call/release) behind every isolate use | user-approved-plan | accepted |
| D-0077 | Default renderer: worker pool of forked processes with --permission, fs allowlist, no network/child processes/workers, empty env, heap cap, watchdog SIGKILL, respawn and recycling | user-approved-plan | accepted |
| D-0078 | Optional OS sandbox wrapper (bubblewrap preset, Linux, experimental) | user-approved-plan | accepted |
| D-0079 | Separate origin, not separate app: one app answers site and editor hostnames | user-approved-plan | superseded by D-0204 |
| D-0080 | Editor renders blocks on the server (batched /blocks/render RPC); the theme bundle is never served to browsers | user-approved-plan | superseded by D-0192 |
| D-0081 | Production requires distinct site and editor origins (allowSharedOrigin opts out); wrong surface → 404 | user-approved-plan | superseded by D-0204 |
| D-0082 | CSP: editor enforced (nonce + strict-dynamic, no framing); site report-only by default; theme script/style origins allowlisted | user-approved-plan | superseded by D-0204 |
| D-0083 | Request origin derived from X-Forwarded-Host/Proto then Host (Next builds request.url from its bound host) | agent-unreviewed | needs-review |
| D-0084 | Editor receives siteOrigin so "View page" opens the public origin | agent-unreviewed | superseded by D-0192 |
| D-0085 | Editor imports Puck no-external.css (default CSS loads a font from rsms.me, blocked by CSP) | agent-unreviewed | needs-review |
| D-0086 | Worker pool exposes an IPC tap option for diagnostics/tests | agent-unreviewed | needs-review |
| D-0087 | Worker fs allowlist: worker dist, node_modules dirs on isolated-vm resolution path, real paths of isolated-vm and node-gyp-build (both spellings) | agent-unreviewed | needs-review |
| D-0088 | API POST bodies capped at 2 MB | agent-unreviewed | needs-review |
| D-0089 | Editor render RPC accepts data from the authorized editor (isolate treats it as untrusted) | user-approved-plan | superseded by D-0192 |
| D-0090 | Dev hostnames: site on localhost/site.localhost, editor on editor.localhost (allowedDevOrigins *.localhost) | user-approved-plan | superseded by D-0201 |
| D-0091 | @puck-remote/core stays external in Next (serverExternalPackages) because it forks workers from its own files | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Separate app or separate origin (D-0079).** The browser's boundary is the origin, so one app
  answering two hostnames is enough.
- **Editor rendering (D-0080).** The options were a client bundle in a cross-origin sandbox iframe,
  or server rendering. Server rendering was chosen: parity is automatic, and no theme JavaScript
  runs in the admin origin. **This supersedes D-0015 and D-0023.**

### Rationale
- **Spike.** On Node 26, `--permission --allow-addons` plus a filesystem allowlist runs isolated-vm,
  and denies filesystem, network, child processes and worker threads.
- **Limit.** Native code is not checked by Node's permission model. Hence the optional bubblewrap
  wrapper (D-0078) and the planned remote renderer.

### Trade-offs Accepted
- About 90 ms to spawn each worker, once; about 0.1 ms of IPC per block.
- Theme client scripts don't run in the editor.

## Implementation
- `runtime/types.ts` (`RenderRuntime`), `runtime/in-process.ts`, `runtime/worker-pool.ts`,
  `runtime/render-worker.ts`.
- `/blocks/render` RPC with `remote-render.ts` (batching, LRU, debounce).
- `surface.ts` (classification, `requestOrigin`, `securityHeaders`), and `edge.ts`.
- Next proxy updates.

## Investigation Notes
- Next builds `request.url` from its bound host, which broke editor-origin detection. The fix
  derives the origin from `X-Forwarded-Host` / `Host` (D-0083).
- The permission model checks real paths: macOS `/var` → `/private/var` and pnpm symlinks. Both
  spellings are now allowlisted (D-0087).
- Puck's default CSS imports a font from `rsms.me`, so the editor uses `no-external.css` (D-0085).

## Challenges & Solutions
A stale `next-server` from an earlier session held port 3101 and served an old build during
verification. Servers are now stopped by port.

## Impact Assessment
- **Security:** a large improvement (see the threat model in the docs).
- **Performance:** 4.3 ms per page for the worker pool vs 3.8 ms in-process.

## Quality Assurance
115 tests (sandbox × 2 runtimes, worker permissions, watchdog, crash, recycle, IPC secrets,
surfaces, headers, render RPC); live dev and production checks.

## Outcome & Lessons
Verify against a clean production process: an orphaned server can silently invalidate results.

## Tags
security isolation worker-pool editor origins csp
