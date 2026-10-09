---
title: "Strongly typed useEditor().rpc"
description: "Strongly typed useEditor().rpc"
---

# Branch ADR: feat/typed-rpc

## Meta
- **Branch**: feat/typed-rpc
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
`useEditor().rpc(method, params)` was untyped (`string` method, `unknown` params and result).

### Goals
Type it with the admin page's `rpc` map type, with no new hook and no runtime change.

### Non-Goals
A proxy-based client (`rpc.method()`), runtime validation of results, a `Jsonify` type.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0316 | Strong typing on the existing useEditor().rpc (no new hook), typed by the admin page rpc object type | user | accepted |
| D-0317 | useEditor<T extends RpcHandlers = RpcHandlers>() with TypedRpc<T> = <K>(method: K, ...params: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>; runtime unchanged, loose by default | user-approved-plan | accepted |
| D-0318 | RpcHandlers and TypedRpc exported from @puck-remote/editor/protocol, re-exported by /frame and /react; PuckEditorFrame rpc prop typed RpcHandlers; no runtime helper | user-approved-plan | accepted |
| D-0319 | RPC handlers keep one params value; parameterless handlers are called without a second argument | user-approved-plan | accepted |
| D-0320 | Typed RPC results are the handler return types; no Jsonify transform (JSON is enforced at runtime, documented) | user-approved-plan | accepted |
| D-0321 | Example: rpc map in admin/editor/rpc.ts with AdminRpc type; currentUser action; editor badge uses useEditor<AdminRpc>().rpc(currentUser) | user-approved-plan | accepted |
| D-0322 | Typed RPC tests with expectTypeOf in packages/editor/test/rpc-types.test.ts, typecheck and a browser check | user-approved-plan | accepted |
| D-0323 | Docs: editor-app guide Typed calls section, testing map | user-approved-plan | accepted |
| D-0324 | Typed RPC on feat/typed-rpc from feat/admin-prefix-redirect | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- A new `useRpc()` hook returning a proxy (first proposal, rejected by the owner).
- A generic on `useEditor` (chosen).

### Rationale
It reuses the existing API; it's types only, so nothing changes at runtime.

### Trade-offs Accepted
The type is an assertion (types don't cross origins); a mismatch between the editor's assumed type and the admin's real map is only caught by `tsc` when both share the type.

## Implementation
### Public API / config changes
`RpcHandlers` and `TypedRpc` types (`/protocol`, `/frame`, `/react`); `useEditor<T>()`; `EditorContextValue<T>`; `PuckEditorFrameProps.rpc: RpcHandlers`.

### Docs pages touched
guides/editor-app (Typed calls), quality/testing.

- `packages/editor/src/{protocol,frame,react}.tsx?` (types).
- `packages/editor/test/rpc-types.test.ts`.
- Example: `admin/editor/rpc.ts` (`AdminRpc`), a `currentUser` action, and the editor badge using `useEditor<AdminRpc>().rpc('currentUser')`; verified in the browser ("· admin").

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
editor rpc types
