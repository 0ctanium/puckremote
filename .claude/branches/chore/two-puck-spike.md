---
title: "Spike: two synced Puck instances (admin fields/plugins, frame canvas/DnD)"
description: "Spike: two synced Puck instances (admin fields/plugins, frame canvas/DnD)"
---

# Branch ADR: chore/two-puck-spike

## Meta
- **Branch**: chore/two-puck-spike
- **Type**: chore
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
The whole Puck UI runs in the editor frame, where theme code runs, so any admin feature the frame can trigger (publish, version history, rollback) is reachable by theme code.

### Goals
Find out if two synced Puck instances can split the editor: trusted admin Puck (header, fields, history, plugins) and the frame Puck (canvas, drawer, outline, drag and drop).

### Non-Goals
Package API changes; production UI; merging spike code into packages.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0325 | Time-boxed spike of a two-Puck split (admin: header, fields, plugins; frame: canvas, drawer, outline), admin-authoritative | user | accepted |
| D-0326 | Spike on chore/two-puck-spike with a research ADR; findings in the ADR and internal/quality/research-two-puck.mdx | user-approved-plan | accepted |
| D-0327 | Owner uncommitted HeaderAction work stashed as "wip: HeaderAction", not part of the spike | user-approved-plan | superseded by D-0335 |
| D-0328 | Spike scope: example app only (src/spike, admin/spike page, editor page ?spike=1); packages unchanged | user-approved-plan | accepted |
| D-0329 | Spike channel: minimal postMessage with origin and source checks; frame→admin ready/action, admin→frame state with a sequence number | user-approved-plan | accepted |
| D-0330 | Spike sync: admin holds the data; frame applies locally then sends; admin broadcasts; undo/redo only on the admin | user-approved-plan | accepted |
| D-0331 | Spike admin config from the manifest (mapFields, visibleIf, placeholder render, resolveData via the server action) | user-approved-plan | accepted |
| D-0332 | Spike time box: stop after the five questions or the first blocker needing Puck internals | user-approved-plan | accepted |
| D-0333 | Spike verification: manual browser checklist, answers recorded with evidence; no automated tests | user-approved-plan | accepted |
| D-0334 | Spike outcome: go / no-go / go-with-changes recommendation; nothing merged into packages from the spike | user-approved-plan | accepted |
| D-0335 | Correction to D-0327: nothing was stashed; the working tree was already clean when the spike started (the owner changes were no longer present) | agent-unreviewed | needs-review |
| D-0336 | Spike tries both frame→admin sync styles and reports the better: (A) full state + ack via <PuckRemoteEditor> overrides.puck; (B) Puck actions via a temporary, uncommitted onAction pass-through | user | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- A (whole state + ack): no package change, but echo control by content comparison.
- B (Puck actions): needs `onAction` passed through `<PuckRemoteEditor>`; reports user intent.

### Rationale
B: correct on the first try, including deselect and undo granularity, which A gets wrong by construction.

### Trade-offs Accepted
A small package change for `onAction` in a real implementation.

## Implementation
- Spike code: `examples/app/src/spike/{channel.ts, SpikeAdmin.tsx, SpikeFrame.tsx}`, `(app)/admin/spike/page.tsx` and `(puck)/editor/page.tsx` (`?spike=`).
- The temporary `onAction` pass-through in `packages/editor/src/react.tsx` was reverted before committing (D-0336), so `?mode=action` no longer works on this branch.

## Investigation Notes
### Questions
The five questions of the plan: Puck APIs, selection with slots, inline editing, local UI state, layout and cost.

### Experiments / spikes
- Manual browser checks by the owner and admin-side console logs (`[spike] seq … in … → admin selected …`).
- Messages: about 1–3 KB per state on the example page, about 3 ms round trip, no perceptible lag in either variant.
- A: drag and drop, selection (incl. slots), field edits, array items and undo/redo work. Deselect fails: the frame's echo filter compares content and never forgets the last received state, so returning to it (same data, no selection) is never reported. Load-time normalization echoes add history entries.
- B: all checks pass on the first try.

### Recommendation for the human
Go with B, with changes (see the research page): real `onAction` support in `@puck-remote/editor`, protocol integration with validated actions, admin-side validation, deterministic duplicates, a full resync safety net, a rebuilt UI layout, and `resolveData` and the fields UI moving to the admin. Needs a planned feature branch.

- Rendering the frame Puck directly would need `@puck-remote/sdk/browser` and `import()` in app code, which the no-dev-code guard forbids.
- Using `<PuckRemoteEditor>` with `overrides.puck` avoided that.

## Challenges & Solutions
- The browser pane was hidden for the agent, so the owner ran the interactive checks.
- The spike messages share the window channel and trigger the real protocol's "invalid message" error (filtered in the spike).

## Impact Assessment
Security gain: authority-bearing features never need to be reachable from the frame. Cost: a second Puck config and a custom layout to maintain.

## Quality Assurance
Manual checklist only (D-0333). `pnpm typecheck` and the core tests (incl. the guard test) pass.

## Outcome & Lessons
Feasible with Puck 0.23's public API. Report what the user did (actions), not states: state diffing needs content-based echo control, which loses legitimate edits.

## Tags
editor research security
