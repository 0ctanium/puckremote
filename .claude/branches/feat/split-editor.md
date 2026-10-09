---
title: "Split editor: admin Puck holds the data, frame Puck syncs by actions"
description: "Split editor: admin Puck holds the data, frame Puck syncs by actions"
---

# Branch ADR: feat/split-editor

## Meta
- **Branch**: feat/split-editor
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
All of Puck ran in the editor frame, where theme code runs, so every admin feature the frame could trigger was reachable by theme code. The spike (`chore/two-puck-spike`) showed a split that works with Puck 0.23's public API, and that syncing by actions (B) is correct where syncing by state (A) loses deselects.

### Goals
The admin page's Puck (manifest config, no theme code) holds the data, the history and the fields; the frame keeps the canvas, drawer and outline and proposes validated actions. Publish, history and future plugins live only on the admin side.

### Non-Goals
Keeping the old full-frame mode; a version-history plugin; fixing Puck recording load-time resolveData in the history.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0325 | Split editor replaces the full-Puck-in-the-frame model: the admin Puck (manifest config, no theme code) holds data, history and fields; the frame (theme code) runs canvas, drawer and outline and reports Puck actions; the admin replays them and sends back its state | user | accepted |
| D-0326 | Frame UI: Puck's own layout with the header removed and the right (fields) panel hidden; stop and ask if Puck keeps an empty column | user | accepted |
| D-0327 | <PuckEditorFrame> in /frame becomes the admin-side component: renders the admin <Puck>, accepts children (your layout); <PuckEditorFrame.Canvas /> renders the iframe | user | accepted |
| D-0328 | PROTOCOL_VERSION 2 (the change message is removed) | user-approved-plan | accepted |
| D-0329 | Protocol v2: editor→admin ready, action {seq, action}, intent {undo\|redo}, rpc, error; admin→editor init, state {data, itemSelector, ack}, ui {leftSideBarVisible}, rpc:result, error | user-approved-plan | accepted |
| D-0330 | Admin validates frame actions with zod: insert (manifest blocks or __missing), move/reorder/remove/duplicate (int indexes, string zones), replace/replaceRoot (page item schema), setUi itemSelector only; others refused; actions size-checked (rpcBytes), not rate-limited; page bounded by pageBytes | user-approved-plan | accepted |
| D-0331 | Echo/order: frame numbers actions; admin state carries ack; frame applies state only if ack >= its last seq, with recordHistory false, and ignores the actions Puck emits for those | user-approved-plan | accepted |
| D-0332 | Duplicates and divergence: the admin state broadcast (its ids) replaces the frame state; no id rewriting | user-approved-plan | accepted |
| D-0333 | <PuckRemoteEditor> forwards onAction, strips resolveData, hides header and right panel, forwards cmd-Z as intent; fields prop and change sending removed; keeps handshake, theme loading, useEditor, overrides/plugins/ui/iframe/viewports | user-approved-plan | accepted |
| D-0334 | useEditor() unchanged; the example frame RPC map becomes { currentUser } (resolveData moves to the admin) | user-approved-plan | accepted |
| D-0335 | <PuckEditorFrame> props: payload, editorUrl, editorOrigin?, options?, rpc?, resolveData(block, props), fields?, onChange?, onError?, overrides/plugins for the admin Puck, children; config from buildEditorConfig with placeholder renders; default layout Canvas + Puck.Fields | user-approved-plan | superseded by D-0347 |
| D-0336 | PuckEditorFrame.Canvas: the sandboxed iframe with the existing frameProblem checks, sandbox and referrerPolicy, plus className/style/title | user-approved-plan | accepted |
| D-0337 | /frame exports stripResolved(data) and usePuckEditorFrame() → { payload, setLeftSideBarVisible, frameReady }; apps use Puck createUsePuck for history and data | user-approved-plan | accepted |
| D-0338 | Example: ClientEditor with header (path, theme, user, undo/redo, left panel toggle, status/dirty, Publish); rpc.ts { currentUser }; EditorPage reduced to <PuckRemoteEditor> | user-approved-plan | accepted |
| D-0339 | Split editor branch starts from feat/typed-rpc; spike code not carried over | user-approved-plan | accepted |
| D-0340 | Split editor tests: protocol v2 and action validation, admin handler and frame sync rule as pure functions, stripResolved, type tests, parity; browser checklist | user-approved-plan | accepted |
| D-0341 | Split editor docs: concepts/editor, guides/editor-app rewrite, next-js snippets, editor-protocol, editor-lifecycle, threat-model, packaging, testing, research page link | user-approved-plan | accepted |
| D-0342 | Split editor on feat/split-editor with its ADR | user-approved-plan | accepted |
| D-0343 | Plan item B1 listed D-0231 and D-0251 as superseded by mistake: useEditor() and the shared module registration remain valid; only D-0192 (and D-0209, D-0194, D-0230 by their own items) is superseded | agent-unreviewed | needs-review |
| D-0344 | Admin page uses Puck's native header; actions added through the headerActions override; Puck's Publish button calls a new onPublish prop | user | accepted |
| D-0345 | The plugin rail is on the admin page; framePlugin(name, { label, icon }) marks a plugin whose panel renders in the frame; defaults: admin [framePlugin(blocks), outlinePlugin()], frame [blocksPlugin()] | user | accepted |
| D-0346 | The viewport/zoom toolbar stays in the frame; the admin's canvas controls are hidden | user | accepted |
| D-0347 | <PuckEditorFrame> renders Puck's native layout by default (frame in the preview area); children still replace it with a custom composition | user | accepted |
| D-0348 | Feasibility gate: admin preview override hosting the frame (iframe disabled) and a frame plugin panel without the rail; stop and ask if it needs CSS on Puck internals or fails | user-approved-plan | accepted |
| D-0349 | ui message becomes { leftSideBarVisible, plugin: string \| null } (plugin up to 64 chars); PROTOCOL_VERSION stays 2 | user-approved-plan | accepted |
| D-0350 | Admin: framePlugin returns a Puck plugin with an empty render; an effect maps ui.plugin.current and leftSideBarVisible to the admin left panel and the frame ui message; new props onPublish, headerTitle, headerPath (default /slug) | user-approved-plan | accepted |
| D-0351 | Frame: <PuckRemoteEditor plugins> defaults to [blocksPlugin()]; its left panel shows the plugin named by the ui message (hidden on null); rail hidden; header and fields stay removed | user-approved-plan | accepted |
| D-0352 | Example: native layout, headerActions override with status, user and Log out next to Puck Publish; publish via onPublish | user-approved-plan | accepted |
| D-0353 | Tests: ui message with plugin, pure frameUi(current, framePluginNames, leftVisible) mapping; browser checklist for rail, drawer in frame, outline on admin, native header | user-approved-plan | accepted |
| D-0354 | Docs: editor-app guide (native layout, framePlugin, header overrides, onPublish, custom layout), concepts/editor, editor-protocol, editor-lifecycle, testing | user-approved-plan | accepted |
| D-0355 | Native-layout work continues on feat/split-editor in the same ADR | user-approved-plan | accepted |
| D-0356 | Frame hides Puck's plugin rail by registering its panel plugin under Puck's 'legacy-side-bar' name (no CSS); one place to update if Puck changes that detection | user | accepted |
| D-0357 | Correction: the native-layout plan named D-0327 and D-0331 as superseded; the default layout was D-0335 (superseded by D-0347); the ui message (D-0329) is extended by D-0349, not replaced | agent-unreviewed | needs-review |
| D-0358 | While a frame plugin is active the admin collapses its left panel to ui.leftSideBarWidth = 1 (Puck ignores 0) and restores the previous width afterwards; the rail keeps its native active state | user | accepted |
| D-0359 | Admin Puck uses _experimentalFullScreenCanvas so the frame fills the center area with no outer padding | user | accepted |
| D-0360 | <PuckRemoteEditor> injects one CSS rule in the frame hiding Puck's plugin nav ([class*=PuckLayout-nav]) on all sizes; relies on Puck's class-name prefix | user | accepted |
| D-0361 | Left panel width is synced both ways between the admin and the frame | user | accepted |
| D-0362 | Protocol: host→editor ui gains leftSideBarWidth (int 0..2000 \| null); new editor→host ui { leftSideBarWidth } on frame resize, display-only; PROTOCOL_VERSION stays 2 | user-approved-plan | accepted |
| D-0363 | Admin: shared width = its panel width (savedWidth while a frame plugin is active), sent with every ui message; frame-reported widths update it; null = Puck default | user-approved-plan | accepted |
| D-0364 | Frame: applies the host width with recordHistory false; reports user resizes, skipping echoes of the last received width | user-approved-plan | accepted |
| D-0365 | Layout polish tests: ui width messages both ways, frameUi width, host callback; browser checks at desktop and narrow widths | user-approved-plan | accepted |
| D-0366 | Layout polish docs: editor-protocol, editor-lifecycle, editor-app guide note, testing; same ADR | user-approved-plan | accepted |
| D-0367 | framePlugin sets Puck's mobilePanelHeight 'min-content' so on small admin screens its empty panel takes no height and the frame keeps the space (the frame shows the real panel) | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Sync: whole state (A, loses deselects, history echoes) / actions (B, chosen).
- Scope: replace (chosen) / keep both modes.
- Frame UI: Puck's own UI trimmed (chosen) / composed layout.
- Name: reuse `<PuckEditorFrame>` (owner) / new `<PuckRemoteAdmin>`.

### Rationale
- B reports what the user did; remote states are marked when applied, so no content comparison is needed.
- One model is one security story.
- Puck's trimmed UI keeps its sidebar and toolbar for free (confirmed: no empty column).

### Trade-offs Accepted
- Actions can be refused after the frame applied them locally; the next state reverts the frame.
- `duplicate` ids differ until the admin's state arrives.
- `fields` moved from `<PuckRemoteEditor>` to `<PuckEditorFrame>`.

## Implementation
### Public API / config changes
- `PROTOCOL_VERSION` 2, with messages `action`, `intent`, `state` and `ui`; `change` removed; `LIMITS.changeDebounceMs` removed.
- `/frame`: `<PuckEditorFrame>` (the admin's Puck, with new props `resolveData`, `fields`, `overrides`, `plugins` and `children`; `editorOrigin` now optional), `PuckEditorFrame.Canvas`, `usePuckEditorFrame`, `stripResolved`, and `colorField`/`linkField`/`mediaField` (moved from `/react`); `hostMessageHandler` options changed.
- `/react`: `<PuckRemoteEditor>` loses `fields`; new `toFrameAction` and `createFrameSync`; `HostConnection` gains `action`, `intent`, `onState` and `onUi`, and loses `change`.
- `/protocol`: `FrameAction`, `ItemSelector`, `frameActionSchema`.

### Docs pages touched
concepts/editor, concepts/origins, guides/editor-app (rewritten), installation, index, next-js/index, internal/architecture editor-protocol, editor-lifecycle, threat-model and packaging, quality/testing and known-gaps.

- `packages/editor/src/{protocol.ts, frame.tsx, react.tsx, config.tsx}`; tests in `packages/editor/test/protocol.test.ts` (18).
- Example: `ClientEditor.tsx` (admin Puck with header: undo/redo, panel toggle, status, Publish; `Puck.Fields`), `rpc.ts` `{ currentUser }`, `EditorPage.tsx` reduced.
- Checked in the browser by the agent:
  - the frame shows Puck's UI without a header or an empty right column;
  - selection of Card and Hero, and deselect to root fields;
  - an admin field edit shows in the canvas, sets "Unpublished changes" and enables Publish;
  - one Undo reverts it; ⌘Z and ⇧⌘Z in the frame go through the admin's history;
  - the left panel toggle works;
  - no unsaved status after load.
- A synthetic drag didn't drop (too fast for dnd-kit); drag, duplicate, array items and publishing twice are left for the owner to check.

## Follow-up: Puck's native layout on the admin page (D-0344 to D-0358)
- `<PuckEditorFrame>` now renders Puck's native layout by default: header with title, undo/redo and Publish (`onPublish`); the plugin rail; the outline; the fields.
- The frame sits in the `preview` override, and the admin has no Puck canvas (`iframe.enabled: false`). Custom children are still supported.
- `framePlugin(name)` marks rail plugins whose panel renders in the frame. The defaults are `framePlugin('blocks')` and `outlinePlugin()`.
- The frame hides Puck's rail by naming its single panel plugin `legacy-side-bar`. It shows the plugin named by the `ui` message (`{ leftSideBarVisible, plugin }`).
- While a frame plugin is active, the admin collapses its own panel to 1px (Puck ignores 0) and restores the width afterwards.
- Findings while checking feasibility:
  - Puck hides both panels if the window is under 638px wide when it loads (seen once with a narrow browser pane);
  - Puck moves a plugin that replaces a default one to the end of the rail, so the default list includes `outlinePlugin()` explicitly to keep Blocks first.
- Checked in the browser by the agent:
  - the rail is on the admin page, Blocks first;
  - with Blocks active, the drawer is in the frame and the admin panel collapses;
  - with Outline active, the outline is on the admin page, the frame's drawer is hidden, and selecting a block in the outline shows its fields;
  - an edit shows "Unpublished changes", and Puck's native undo removes it;
  - Puck's native Publish works ("Published …", same theme id for identical content).
- Tests: editor 20, including `frameUi` and the `ui` message.
- A core worker watchdog test failed once while the dev server was running, then passed twice. It's timing-based and unrelated.

## Follow-up: layout polish (D-0359 to D-0367)
- The admin Puck uses `_experimentalFullScreenCanvas`, so the frame fills the center area with no side padding. Puck keeps 24px of top padding on screens 1198px and wider: its `:not(:has(controls))` rule outranks full-screen mode. This is open.
- The frame injects `[class*="PuckLayout-nav"]{display:none}`, so it never shows Puck's rail or mobile tab bar.
- `framePlugin` uses `mobilePanelHeight: 'min-content'` (agent choice, D-0367): on a small admin page the admin's empty panel takes no height, and the frame shows the drawer as its own bottom sheet.
- The left panel width is shared through `ui.leftSideBarWidth` in both directions.
- Checked in the browser:
  - narrow admin page: the admin's tab bar shows and the frame's doesn't; Blocks shows the drawer as a bottom sheet in the frame;
  - wide: no side padding;
  - widening the outline to 389px keeps it at 389px after Blocks and back.
- Not confirmed: resizing the drawer inside the frame and seeing the outline follow. The synthetic drag inside the scaled iframe didn't hit the handle; left for the owner. The protocol path is unit-tested.

## Investigation Notes
See `chore/two-puck-spike` (research page `internal/quality/research-two-puck` on that branch). Found here: Puck records load-time `resolveData` as undo steps on the admin side (now a known gap).

## Challenges & Solutions
- The decision IDs D-0325 to D-0343 overlap with the spike branch's IDs (both branched from `feat/typed-rpc`); only one of the two branches should be merged, or IDs will need renumbering.
- Plan item B1 named D-0231 and D-0251 by mistake (recorded as D-0343).
- The research page lives on the spike branch, so B17's link from it wasn't added here.

## Impact Assessment
Security: authority-bearing features are never reachable from the frame; frame actions are validated (shape, blocks, permissions, size). Performance: one state message per change (page JSON, a few KB on the example). Maintenance: two Puck configs from one builder.

## Quality Assurance
`pnpm test` (core 94 with 1 skipped, CLI 14, editor 18, next 9), `pnpm typecheck`, `pnpm lint:pkg`, `pnpm docs:build` and `pnpm adr check` pass. Browser checks are listed under Implementation.

## Outcome & Lessons
The split ships as the only model. Reporting actions (not states) and marking remote applies keeps the two Pucks in step without content diffing.

## Tags
editor security protocol
