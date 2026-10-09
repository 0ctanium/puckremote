---
title: "Interactive theme components on public pages (islands)"
description: "Interactive theme components on public pages (islands)"
---

# Branch ADR: feat/islands

## Meta
- **Branch**: feat/islands
- **Type**: feat
- **Created**: 2026-10-08
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-08)
- **PR**: (not yet created)

## Problem Statement
### Context
Public pages were isolate SSR only (D-0003): block HTML was inserted without hydration, so a theme
component with state or handlers (the example's Counter) rendered but did nothing on the site. It
only worked in the editor, which runs bundle.browser.js.

### Goals
Theme client components work on public pages, React-style: modules marked "use client" are
rendered in the isolate as before and hydrated in the browser from a small islands-only bundle,
with per-island timing.

### Non-Goals
Whole-page hydration; slots or children inside islands; non-JSON props; island-specific CSP changes.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0243 | Theme client components are the exports of modules starting with "use client" (islands), detected by the CLI; SSR in the isolate, hydrated on public pages | user | accepted |
| D-0244 | Public pages load a separate islands-only bundle (bundle.islands.js); bundle.browser.js stays editor-only | user | accepted |
| D-0245 | Island hydration timing is configurable per island | user | accepted |
| D-0246 | Timing is a reserved use-site prop hydrate: load (default) \| idle \| visible, stripped before the component | user-approved-plan | accepted |
| D-0247 | Island id is "<theme-relative path>#<export>"; only function exports become islands | user-approved-plan | accepted |
| D-0248 | Island props must be JSON (round-trip checked in the isolate), no children; 64 KB per island, 200 islands per page; violations fail the block | user-approved-plan | accepted |
| D-0249 | SDK gains internal island() and hydrate typing; RenderOutput carries islands; SDK_MAJOR stays 3 | user-approved-plan | accepted |
| D-0250 | Core: RenderedBlock.islands, htmlToReact swaps nonce-checked island markers for a use-client ThemeIsland, PreparedPage.islandsUrl, bundle.islands.js public | user-approved-plan | accepted |
| D-0251 | One shared helper registers __puckRemoteModules for the editor and for islands | user-approved-plan | accepted |
| D-0252 | No new site CSP directive for islands (same-origin bundle under self + strict-dynamic); verify enforced, ask if blocked | user-approved-plan | accepted |
| D-0253 | Hydration mismatches between isolate and host React are left to React 19 recovery; documented as a known gap | user-approved-plan | accepted |
| D-0254 | Islands work happens on feat/islands from feat/m3a-content-lifecycle; owner uncommitted changes untouched except the counter example | user-approved-plan | accepted |
| D-0255 | Example: Counter island in the Card with a start prop and one hydrate="visible" use | user-approved-plan | accepted |
| D-0256 | Islands tests: CLI detection and bundle, core markers/records/limits/forged markers, parity, browser verification | user-approved-plan | accepted |
| D-0257 | registerSharedModules() lives in a new @puck-remote/sdk/browser subpath, used by the editor and islands | user | accepted |
| D-0258 | ThemeIsland ships as its own use-client entry, exported as @puck-remote/core/island (internal, used by PuckRemotePage) | user | accepted |
| D-0259 | Island HTML is normalized on the server (html-react-parser htmlToDOM + dom-serializer 3.1.1 as a direct core dependency) before raw insertion | user | accepted |
| D-0260 | no-dev-code guard: explicit BROWSER_ONLY allowlist (ThemeIsland.tsx) exempt from the dynamic-import and SDK rules, plus a runtime check that server rendering never loads islands | user | accepted |
| D-0261 | Shared-modules error now says "is not provided by the page (registerSharedModules from @puck-remote/sdk/browser)"; nav places the islands guide after Theme development and the internal page after Slot swap | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- D-0243 declaration: `"use client"` detection (chosen) / explicit `island(name, C)` / an `islands/` folder.
- D-0244 bundle: islands-only `bundle.islands.js` (chosen) / reuse `bundle.browser.js` (heavier, all blocks on the site).
- D-0245/D-0246 timing: per island (owner) as a use-site `hydrate` prop (chosen) / module-level `export const hydrate`.
- D-0257 helper home: `@puck-remote/sdk/browser` (chosen) / `@puck-remote/core/react` (the editor would need core at runtime).
- D-0258 island entry: `@puck-remote/core/island` subpath (chosen) / an unlisted dist chunk.
- D-0259 island HTML: normalize with dom-serializer (chosen) / insert as-is.
- D-0260 guard test: a BROWSER_ONLY allowlist (chosen) / move ThemeIsland out of core.

### Rationale
- `"use client"` matches what React developers already write; the owner's Counter worked unchanged.
- Hydrating in a separate root inside a `display: contents` wrapper whose HTML the outer (Next) tree
  never reconciles avoids fighting the RSC tree, and unmounting on cleanup fits client navigation.
- Rendering islands after the block's `renderToString` returns avoids reentrancy in React's
  server renderer. Islands nested in an island render as plain components on both sides, so they
  stay consistent.
- Markers reuse the slot-swap nonce rule, so user content can't forge islands.
- Core re-declares `HYDRATE_MODES` and `ISLAND_LIMITS` (the existing EFFECT_LIMITS pattern), because
  the host never imports theme-facing SDK modules.

### Trade-offs Accepted
- Theme JS now runs on public pages through islands too (same trust as `ctx.assets.script`, D-0008).
- The island HTML travels twice (in the page HTML and in the RSC payload).
- Hydration mismatches (React versions, non-deterministic first renders) fall back to client
  rendering (D-0253).

## Implementation
### Public API / config changes
- SDK: `island()` (internal), `IslandProps`, the `hydrate` attribute typing, `HYDRATE_MODES`,
  `ISLAND_LIMITS`, `RenderOutput.islands`, and the new `@puck-remote/sdk/browser`
  (`registerSharedModules`, `BROWSER_MODULES_GLOBAL`).
- Core: `PreparedPage.islandsUrl`, `RenderedBlock.islands`, `@puck-remote/core/island` (internal),
  `bundle.islands.js` served by the theme route, and a `dom-serializer` dependency.
- CLI: `bundle.islands.js` output and the `use-client` plugin. The editor no longer exports
  `BROWSER_MODULES_GLOBAL` (it moved to the SDK).

### Docs pages touched
New: guides/interactive-components, internal/architecture/islands. Updated: concepts/artifacts,
blocks-and-isolate and trust-model, http-api, cli/build-output and programmatic-api, core/index,
sdk/blocks, internal/architecture build-pipeline, editor-lifecycle, slot-swap, packaging and
threat-model, quality/known-gaps and testing, contributing/docs.

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
[Technical and process challenges encountered]

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
- Results: `pnpm test` (core 94 with 1 skipped; CLI 14; editor 9), `pnpm typecheck`,
  `pnpm lint:pkg` and `pnpm docs:build` all pass.
- New tests: `packages/core/test/islands.test.tsx` and CLI island tests. Updated: the parity test
  (island wrappers unwrapped) and the no-dev-code guard.
- Browser (localhost:3100):
  - The Card's counter increments on the public page.
  - Only `bundle.islands.js` loads; `bundle.browser.js` never does.
  - `hydrate="visible"`: not loaded at the top of the page, loaded after scrolling.
  - No CSP reports under the site's report-only policy, which applies the same rules as enforce.
  - The editor canvas renders the island directly ("Count: 1").
  - The only console error is an existing `data-enhanced` mismatch on `<html>`, caused by the
    theme's `enhance.js`, which is unrelated to islands.

## Outcome & Lessons
[Final results and lessons learned]

## Tags
render islands sdk cli
