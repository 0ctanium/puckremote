---
title: "POC: sandboxed React blocks for Puck"
description: Proof of concept validating that untrusted React blocks can drive a Puck editor and an RSC public site without the host executing developer code outside isolated-vm.
---

# Branch ADR: feat/poc-sandboxed-blocks

## Meta
- **Branch**: feat/poc-sandboxed-blocks (backfilled; the work happened on `main`, commits 5c9f3a7…a6afec7)
- **Type**: feat
- **Created**: 2026-10-07
- **Status**: Merged
- **Author**: Claude
- **Approved by**: project owner (initial spec, answers to questions, approved plan)
- **PR**: none (pre-dates the branch workflow)

## Problem Statement
### Context
The project owner wrote a detailed spec ("POC: Sandboxed React blocks for Puck"). In it, developers
write Puck blocks in React (`defineBlock`), and a CLI builds them into a versioned artifact
(manifest, bundle, assets). The host builds Puck configs from the manifest's JSON only, runs every
data query itself, and executes nothing but the synchronous `render` and adapter translators inside
isolated-vm. The spec fixed 12 decisions up front and asked for 21 tests.

### Goals
Validate the central claim: **untrusted React can drive a Puck editor and a server-rendered public
site without the host ever executing developer code outside the isolate.**

### Non-Goals
Payload integration, auth, multi-tenancy, remote builds, `$ref` dependent queries, pagination, and
hardened process-level sandboxing. These were the spec's own non-goals.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0001 | One file per block (blocks/<slug>.tsx) with a default-export defineBlock; no .server files | user | accepted |
| D-0002 | Everything except render is JSON, extracted at build time on the developer machine and re-validated by the host | user | accepted |
| D-0003 | render(props, data, ctx) is synchronous and pure, runs in isolated-vm, renderToString inside the isolate; no handlers/state reach the page | user | accepted |
| D-0004 | Data is declarative: blocks declare queries, the host resolves them (parallel, deduped, budgeted); the isolate never does I/O | user | accepted |
| D-0005 | Theme adapters are sans-IO: toRequest/fromResponse synchronous in the isolate, host performs HTTP | user | accepted |
| D-0006 | No custom/external Puck fields, no permissions/resolvePermissions/function options; visibleIf replaces resolveFields; rich pickers only as host:* fields | user | accepted |
| D-0007 | root.tsx uses defineRoot through the same pipeline; page body passed as <Slot name="children" /> | user | accepted |
| D-0008 | Client JS, custom assets and iframes are allowed in block output (Shopify-like permissiveness) | user | accepted |
| D-0009 | Single tenant: one site, one active artifact pointer | user | accepted |
| D-0010 | The developer builds; the host never builds. A CLI produces and publishes artifacts | user | accepted |
| D-0011 | Client-side data loading (pagination, load more) is the theme developer's responsibility; out of scope | user | accepted |
| D-0012 | Pages using $query params are uncacheable: flagged in the manifest, Cache-Control no-store, editor notice | user | accepted |
| D-0013 | Stack: pnpm monorepo, TypeScript, vitest, Next.js App Router, Puck (current), isolated-vm, esbuild (CLI), zod, html-react-parser, undici | user | accepted |
| D-0014 | Target native arm64 Node 26 (isolated-vm has no darwin-x64 prebuild for ABI 147) | user | accepted |
| D-0015 | Editor renders blocks by evaluating bundle.js in the browser (spec-preferred path) | user | superseded by D-0080 |
| D-0016 | Public data is resolved by a host tree walker (not Puck resolveAllData) so the page can be deduped and budgeted | user-approved-plan | accepted |
| D-0017 | Unknown block types are rewritten to a __missing block (Puck drops them silently) and restored on save | user-approved-plan | accepted |
| D-0018 | Pre-render pass: resolve data, render every block in one fresh context, then Puck <Render> only parses HTML | user-approved-plan | accepted |
| D-0019 | Head merge: stylesheets/scripts via React 19 hoisting; title/meta via Next generateMetadata | agent-unreviewed | needs-review |
| D-0020 | Host calls the isolate with async Reference.apply plus a wall-clock watchdog that disposes the isolate | agent-unreviewed | needs-review |
| D-0021 | Only two isolate shims (MessageChannel, TextEncoder); no timers, fetch, process or require | agent-unreviewed | needs-review |
| D-0022 | Page cacheability headers set in the Next proxy (x-page-cacheable / no-store) | agent-unreviewed | needs-review |
| D-0023 | Editor loads bundle.js into a hidden same-origin iframe realm (shims would break React in the editor window) | agent-unreviewed | superseded by D-0080 |
| D-0024 | pnpm 12 installed globally into the fnm Node 26 (Node 26 no longer ships corepack) | agent-unreviewed | needs-review |
| D-0025 | Every script sets NODE_OPTIONS=--no-node-snapshot (isolated-vm guidance, harmless on Node 26) | agent-unreviewed | needs-review |
| D-0026 | One isolate per artifact version, compiled once; fresh context per page request; blocks of one request share it | user | accepted |
| D-0027 | Slot markers carry a per-render nonce; the host swaps only nonce-valid markers, each slot at most once | user | accepted |
| D-0028 | Editor resolveData writes a reserved read-only __data prop, stripped on save, always re-resolved at render | user | accepted |
| D-0029 | Content source mocked in-memory with collection/field allowlists, limit/depth clamps and a host-only draft mode | user | accepted |
| D-0030 | Outbound HTTP: https only, origin allowlist, pinned DNS rejecting private IPs, manual same-origin redirects, timeouts and size caps | user | accepted |
| D-0031 | Secrets are bound to origins in host config and substituted on the host; never enter the isolate | user | accepted |
| D-0032 | Tests point the manifest adapter origin at a random-port mock API (test seam) | agent-unreviewed | needs-review |
| D-0033 | Queries deduped by hash; static budget (count, bytes, wall time) degrades later blocks in tree order | user | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Runtime target (D-0014).** The machine's default Node was x64 v26 under Rosetta. isolated-vm
  7.0.1 ships prebuilt binaries for darwin-arm64 ABI 147 but not for darwin-x64. The options were
  native arm64 Node, an x64 source build, or trying the source build and falling back to arm64. The
  owner chose native arm64 Node 26.
- **Editor rendering (D-0015).** The options were evaluating `bundle.js` in the editor browser so
  `render` runs synchronously in Puck's canvas, or a server render RPC. The owner chose the client
  bundle, as the spec preferred. **This was superseded in M2 (D-0080)** once themes were declared
  untrusted.
- **Public data resolution (D-0016).** Puck's `resolveAllData` resolves each node independently, so
  queries can't be deduplicated and the page budget can't be applied. A host-owned tree walker was
  chosen.
- **Unknown blocks (D-0017).** Puck's RSC renderer returns `null` silently for an unknown type. The
  options were patching Puck, accepting silent drops, or rewriting to a `__missing` block. The
  rewrite was chosen, and it is reversed on save.

### Rationale
- **Pre-render pass (D-0018).** All data is resolved, then every block is rendered in ONE fresh
  isolate context, before Puck's `<Render>` runs. This yields head effects before any markup,
  respects "one context per request", and later let the host call the isolate asynchronously
  (D-0020), so the watchdog can fire.
- **Async `apply` plus watchdog (D-0020).** A synchronous `applySync` blocks the event loop, so a
  host `setTimeout` watchdog could never fire. The async apply keeps the code inside the isolate
  synchronous.
- **Two shims (D-0021).** These were found empirically by removing shims one at a time:
  react-dom/server.browser needs only `MessageChannel` (probed at init) and `TextEncoder`. No timers
  means theme code cannot schedule work.

### Trade-offs Accepted
- Blocks within one request share a context and can affect each other (accepted by the spec).
- `isolated-vm` runs inside the host process and the project is in maintenance mode (addressed by
  M2's worker pool).

## Implementation
- SDK (`defineBlock`, `defineRoot`, `defineAdapter`, `Slot`, JSON query builders, the isolate
  runtime).
- CLI (esbuild IIFE bundle with shims; metadata extraction on the developer's machine; build
  validation).
- Host:
  - artifact loader (zod and sha256);
  - isolate runner;
  - query resolver (dedupe, static budget, cache);
  - payload mock, HTTP source with SSRF defenses and origin-bound secrets;
  - Puck RSC config, slot swap with nonce;
  - editor with `resolveData` → `__data`.
- 58 tests covering all 21 spec items.

## Investigation Notes
- **Microtask behaviour.** `await` loops run to completion within the synchronous call, and V8's
  `timeout` covers the drain. Async code therefore cannot outlive a call.
- **Puck 0.23 findings.**
  - `resolveData` output is merged into props and persisted in editor state.
  - `resolveAllData` reaches slots.
  - The RSC renderer needs `fields` in its config to detect slot props.
- **Measured costs.** About 17 ms to compile the bundle, about 6 ms per context and about 0.3 ms
  per block render, on an M1 Max.

## Challenges & Solutions
- **The memory-hog test raced the CPU timeout under load.** It was made deterministic with a
  generous timeout and faster allocation.
- **A Turbopack dev route table went stale.** `/api/pages` fell through to the catch-all until the
  dev server restarted.
- **The editor bundle iframe's load event fired early.** Readiness detection was switched to
  polling.

## Impact Assessment
Security posture for that phase: V8 isolate plus host-side enforcement. The editor still ran theme
JavaScript in the admin origin, which was flagged as a gap and fixed in M2.

## Quality Assurance
58 tests, `next build`, and live verification of the public page, the editor, save and reload, and
artifact v1 → v2 switch and rollback.

## Outcome & Lessons
The central claim held. The lesson: put the security boundary where nothing is synchronous with the
UI framework, i.e. pre-render, then let the framework only parse HTML.

## Tags
poc isolate puck rsc editor data security
