---
title: "Shopify-like theme file URLs (/cdn/<path>?v=<hash>)"
description: "Shopify-like theme file URLs (/cdn/<path>?v=<hash>)"
---

# Branch ADR: feat/cdn-urls

## Meta
- **Branch**: feat/cdn-urls
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
Theme files were served at `/theme/<artifact-id>/…`. Pages live in the artifact, so every page save
produced a new id and new URLs for unchanged files, which defeated browser and CDN caches.

### Goals
Shopify-like URLs: a stable path per file (`/cdn/assets/theme.css`) with the file's content version
in `?v=`. Old versions stay servable while pages that reference them are still in caches.

### Non-Goals
An external CDN or object storage upload step; multi-theme scoping (a Shopify `t/<n>` segment).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0262 | Theme file URLs are <routes.theme>/<path>?v=<version> (no artifact id in the path) for assets/**, bundle.browser.js and bundle.islands.js; replaces the /theme/<id>/ layout of D-0197 | user | accepted |
| D-0263 | DEFAULT_ROUTES.theme is /cdn | user | accepted |
| D-0264 | A v from an older artifact is served from that artifact (lookup by content hash) | user | accepted |
| D-0265 | v is the first 12 hex characters of the file sha256 from manifest.files; bytes still verified against the full hash | user-approved-plan | accepted |
| D-0266 | Lookup: current artifact first, then a per-process path+v index built lazily from artifacts.list(), refreshed on pointer change and at most once per 10 s on a miss | user-approved-plan | accepted |
| D-0267 | Matching v: immutable 1-year cache; no or unknown v: current file with no-cache + etag (304 on If-None-Match); missing file 404 | user-approved-plan | accepted |
| D-0268 | Host passes assetVersions (assets/** path to v) in CtxInput; ctx.assetUrl appends ?v when known; the editor builds the same map from manifest.files | user-approved-plan | accepted |
| D-0269 | themeFileUrl(route, path, sha256) replaces themeBase/themeAssetBase; effect URLs still checked by the assetBase prefix | user-approved-plan | accepted |
| D-0270 | No migration: old /<route>/<id>/ URLs answer 404 | user-approved-plan | accepted |
| D-0271 | CDN URL tests: routes (current, older, missing/unknown v, 304, 404s, refresh throttle), rendering, editor payload, browser | user-approved-plan | accepted |
| D-0272 | Internal names: ThemeFiles class, INDEX_REFRESH_MS, VERSION_LENGTH, a refreshes counter for tests; SDK CtxInput.assetVersions optional so themes built with an older SDK still render (unversioned URLs) | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Version in the query (`?v=`, chosen, like Shopify) or in the path (`theme.<hash>.css`).
- Unknown `v`: (a) serve the current file, (b) look the version up in older artifacts (chosen, with
  (a) as the fallback for no or unknown `v`), or (c) 404.
- How `assetUrl` learns versions: the host passes them in `CtxInput` (chosen) or the CLI bakes them
  into the bundles.
- Default route: `/cdn` (chosen) or keep `/theme` and override it in the example.

### Rationale
- Content-hash versions change only when the file does, so page saves and code releases that
  leave a file alone keep its URL.
- The lookup through older artifacts keeps `immutable` correct for pages rendered before a publish.
- The 10 s refresh throttle bounds store scans triggered by random `v`s.
- Passing versions in `CtxInput` keeps `RenderCtx` identical in the isolate and the editor, which
  builds the same map from `manifest.files`.

### Trade-offs Accepted
- About 40 bytes per asset in every render call's input.
- One process-wide manifest cache, which grows with the number of artifacts read.
- No-`v` requests (CSS `url()`s) are revalidated with an etag instead of cached `immutable`.

## Implementation
### Public API / config changes
- `DEFAULT_ROUTES.theme` is now `'/cdn'`.
- Theme URLs are `<route>/<path>?v=<12 hex>`; the old id layout returns 404.
- The isolate `CtxInput` gains `assetVersions`; `editorPayload` returns `bundleUrl` with `?v`
  and `assetBase` without an id.
- `PreparedPage.islandsUrl` carries `?v`.

### Docs pages touched
concepts/artifacts and editor, http-api, security-headers, configuration, installation, next-js/index,
guides/other-frameworks, cli/build-output, core/index, sdk/context, internal/architecture/artifact-loader
(new "Theme file URLs" section) and islands, quality/testing, contributing/docs.

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
[Technical and process challenges encountered]

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
- Results: `pnpm test` (core 94 + new tests, CLI 14, editor 9), `pnpm typecheck`, `pnpm lint:pkg` and
  `pnpm docs:build` all pass.
- Browser, after republishing the example theme: the public page loads
  `/cdn/assets/theme.css?v=…`, `enhance.js?v=…` and `bundle.islands.js?v=…`, and the counter
  hydrates. A matching `v` is served `immutable`; no `v` or an unknown one is served `no-cache`.
- The "asset URLs unchanged after a page save" check is covered by `routes.test.ts`. The admin page
  could not be opened in the browser: the owner's in-progress app restructure has a layout without
  a default export.
- A theme built before this change renders unversioned asset URLs until it is rebuilt.

## Outcome & Lessons
[Final results and lessons learned]

## Tags
assets routes caching
