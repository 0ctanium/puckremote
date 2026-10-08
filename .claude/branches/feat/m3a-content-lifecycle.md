---
title: "M3a: content lifecycle (drafts, publish, history, preview, migrations)"
description: "PageStore v2 with drafts, publishing, revisions and conflicts; signed preview links; block content migrations; HTML caching postponed"
---

# Branch ADR: feat/m3a-content-lifecycle

## Meta
- **Branch**: feat/m3a-content-lifecycle
- **Type**: feat
- **Created**: 2026-10-08
- **Status**: Active
- **Author**: Claude
- **Approved by**: project owner (answers to the M3 questions and the approved M3a plan)
- **PR**: (not yet created)

## Problem Statement
### Context
A page was one record per slug. The editor's Puck "Publish" button overwrote it, and the public site served it right away. There were no drafts, revisions or conflict detection, so two editors silently overwrote each other. `page:publish` was never checked, and the API never passed the slug to `authorize`. Changing a block's fields broke saved pages, because there was no migration path. D-0068 and D-0069 planned this work for M3.

### Goals
- A PageStore contract that covers the publishing workflow:
  - drafts, publish and unpublish;
  - revisions and history;
  - optimistic concurrency;
  - delete.
- Editor UI for the workflow basics.
- Signed, expiring preview links.
- Block content migrations that run in the isolate, with build and publish checks.

### Non-Goals
- Payload adapters and the artifact upload API (M3b, D-0116).
- Rendered-page/HTML caching, postponed to post-V1 (D-0149).
- Autosave (D-0119).
- Localization (D-0073).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0116 | Split M3 into M3a (lifecycle + migrations) and M3b (Payload adapters + artifact upload API), each with its own plan | user | accepted |
| D-0117 | M3 branches start from main after the docs/ADR branch is merged | user | accepted |
| D-0118 | Preview links are signed, expiring tokens; the draft revision renders with draft data | user | accepted |
| D-0119 | Editor M3a scope: workflow basics (save draft, publish, status, conflict, history/restore, preview link), no autosave | user | accepted |
| D-0120 | No legacy page-format reader; the repo's demo pages are converted directly | user | accepted |
| D-0121 | Commit slicing A–F (contract+fs, core API+auth, editor UI, preview, migrations, top-level docs); each commit updates its docs | user-approved-plan | accepted |
| D-0122 | PageStore v2 contract: list, meta, getDraft, getPublished, getRevision, saveDraft, publish, unpublish, delete, history; opaque store-generated revisions; restore done by the core | user-approved-plan | accepted |
| D-0123 | Optimistic concurrency: saveDraft needs the current draft as baseRevision (null = create), publish only accepts the current draft; conflicts are return values | user-approved-plan | accepted |
| D-0124 | Each page revision carries schemaVersion (core page format, starts at 1); higher versions are rejected; internal upgrade registry | user-approved-plan | accepted |
| D-0125 | Revision author is the authenticated Principal.id (optional) | user-approved-plan | accepted |
| D-0126 | pages-fs v2 layout: <slug>/revisions/<n>.json (zero-padded counter = revision id) + <slug>/meta.json, temp+rename, revision before meta | user-approved-plan | accepted |
| D-0127 | pages-fs concurrency: in-process per-slug mutex; documented as single-instance only | user-approved-plan | accepted |
| D-0128 | pages-fs keeps maxRevisions (default 100); never prunes the current draft or published revision | user-approved-plan | accepted |
| D-0129 | Demo pages converted to the new layout, each published as revision 1 | user-approved-plan | accepted |
| D-0130 | Page API routes: GET pages, POST pages/save\|publish\|unpublish\|delete\|restore\|preview-link, GET pages/history\|revision; 409 on conflicts | user-approved-plan | accepted |
| D-0131 | New actions page:delete and page:preview | user-approved-plan | accepted |
| D-0132 | Every page route passes { slug } as the authorize resource | user-approved-plan | accepted |
| D-0133 | History limit default 20, max 100; invalid values are a 400 | user-approved-plan | accepted |
| D-0134 | Public render and pageCacheability read the published revision (none = 404); editor reads the draft; EditorProps gains page meta and previewEnabled | user-approved-plan | accepted |
| D-0135 | Save pipeline: validate, restoreMissing, stripResolved, stamp __v, saveDraft | user-approved-plan | accepted |
| D-0136 | Editor header replaces Puck's Publish: Save draft, Publish (saves first), status badge, History panel with Restore, Copy preview link | user-approved-plan | accepted |
| D-0137 | Conflict banner with Reload and Overwrite | user-approved-plan | accepted |
| D-0138 | beforeunload prompt when there are unsaved changes | user-approved-plan | accepted |
| D-0139 | Preview token: base64url(JSON{s,r,e}).base64url(HMAC-SHA256) via Web Crypto; config preview { secret, ttlSeconds } (default 24 h, max 30 days); off without config; production secret >= 32 bytes | user-approved-plan | accepted |
| D-0140 | Preview delivery: ?puck_preview=<token> on the site origin; no-store + noindex; invalid = 404; param hidden from $query | user-approved-plan | accepted |
| D-0141 | PageContext.preview; Next loadPage reads puck_preview; proxy adds no-store/noindex when present; revocation = rotate secret | user-approved-plan | accepted |
| D-0142 | defineBlock/defineRoot accept version (default 1) and migrations keyed N (N-1 -> N); every step required; items carry props.__v (missing = 1) | user-approved-plan | accepted |
| D-0143 | New __migrate isolate entry point (slots detached and reattached by the host, output validated); sdkMajor bumped 1 -> 2 | user-approved-plan | accepted |
| D-0144 | Migrations run on public render (not persisted) and in loadEditor; save stamps missing __v with the current version | user-approved-plan | accepted |
| D-0145 | Migration failure fails only that block (public) or keeps unmigrated props with a warning (editor); newer __v renders unmigrated with a warning | user-approved-plan | accepted |
| D-0146 | build --baseline <manifest> compares field shape (names, types, nested fields, option values) and fails on unbumped changes or version decrease; also build({ baseline }) | user-approved-plan | accepted |
| D-0147 | publish checks against the active artifact and refuses unless --force | user-approved-plan | accepted |
| D-0148 | Example theme: quote v2 renames author to cite with a migration; demo data stays v1 | user-approved-plan | accepted |
| D-0149 | Rendered-page/HTML caching postponed to post-V1; M3 keeps only the tagged query-result cache; what to cache is decided later from M5 load tests | user-approved-plan | accepted |
| D-0150 | A conflicting write on a missing page returns meta: null (WriteResult conflict meta is PageMeta \| null) | user | accepted |
| D-0151 | pages-fs revision ids are 8-digit zero-padded counters | user | accepted |
| D-0152 | pages-fs exports its options type as FsPageStoreOptions ({ dir, maxRevisions }) | user | accepted |
| D-0153 | API order: CSRF, authenticate (401), parse (400), authorize with { slug } (403), handler; blocks/resolve and blocks/render pass their slug too | user | accepted |
| D-0154 | Newer page format: PageFormatError ('page <slug> uses page format <n>; this version of puck-remote reads up to <max>'), HTTP 500 in the editor API, propagated on public render | user | accepted |
| D-0155 | Invalid GET query strings on the API return 400 'invalid query' | user | accepted |
| D-0156 | unpublish of a missing page is 404; delete is idempotent (200 { ok: true }) | user | accepted |
| D-0157 | handleApi fails closed if a handler returns (other than 400) without authorizing | user | accepted |
| D-0158 | A never-saved page shows the status 'Unsaved changes' | user | accepted |
| D-0159 | Restore with unsaved changes asks 'Discard your unsaved changes and restore this revision?'; the restored draft is loaded into the editor | user | accepted |
| D-0160 | History is a dropdown panel with the 20 newest revisions (date, author, published/draft markers) and 'Load more' | user | accepted |
| D-0161 | Publish is disabled when nothing is unsaved and the draft is already published, and while a request runs | user | accepted |
| D-0162 | History disables Restore on the row that is already the current draft | user | accepted |
| D-0163 | Editor status messages: Saved/Published HH:MM:SS, Restored revision <id>, <Action> failed (<status>); empty history 'No revisions yet.' | user | accepted |
| D-0164 | History rows without an author show an em dash | user | accepted |
| D-0165 | 'Unsaved changes' compares editor data ignoring __data and readOnly keys | user | accepted |
| D-0166 | Editor header overrides are a stable component fed by React context (Puck remounts overrides whose identity changes) | user | superseded by D-0167 |
| D-0167 | Editor header overrides are a stable component fed by React context (Puck remounts overrides whose identity changes); D-0166 was mislabeled as user-approved | agent-unreviewed | needs-review |
| D-0168 | Copy preview link saves unsaved changes first, then links that revision | user | accepted |
| D-0169 | Preview link is copied to the clipboard with status 'Preview link copied (expires <date time>)'; without clipboard access it is shown in a prompt | user | accepted |
| D-0170 | preview config errors: 'preview.secret must be at least 32 bytes in production'; 'preview.ttlSeconds must be an integer between 60 and 2592000 (30 days)' (60 s minimum) | user | accepted |
| D-0171 | Demo app: random preview secret per process in development; production requires PUCK_REMOTE_PREVIEW_SECRET | user | accepted |
| D-0172 | @puck-remote/core/edge exports PREVIEW_PARAM ('puck_preview'); PreparedPage.preview flag; preview config accepts null (off) | user | accepted |
| D-0173 | preview-link returns 404 when previews are off or the revision is missing (after auth); relative URL without origins; tokens over 2048 chars rejected | user | accepted |
| D-0174 | Demo app: 'PUCK_REMOTE_PREVIEW_SECRET is required in production'; clipboard fallback prompt 'Preview link'; status 'Preview link failed (<status>)' | user | accepted |
| D-0175 | Preview responses end up 'no-store' (Next replaces the proxy's 'private, no-store' on dynamic pages); accepted and documented | user | accepted |
| D-0176 | Migration functions take untyped Record<string, unknown> props and return a plain object; the host keeps id, reattaches slots, drops __ keys; one __migrate call per outdated item in the page session, before data resolution | user | accepted |
| D-0177 | Editor surfaces failed migrations via EditorProps.migrationErrors and the status 'Migration failed: <blocks>' | user | accepted |
| D-0178 | build({ baseline: path }); messages 'block "x": fields changed without a version bump (still vN); bump "version" and add a migration', 'block "x": version went down (a → b)'; publish adds '(compared with the active artifact vN; use --force to publish anyway)'; publish({ force }) | user | accepted |
| D-0179 | A failed public migration renders like a failed block render (empty, counted, logged as 'failed (migration)'); its data isn't fetched | user | accepted |
| D-0180 | Build errors for versions/migrations: 'must be an integer >= 1', 'missing migration from version N-1 to N', 'unexpected key: migrations go from 2 to version (V)', 'must be an object of functions keyed by version' | user | accepted |
| D-0181 | Migration runtime texts: '[migrate] <block>#<id> was saved with version N, newer than the theme's M; rendering it as is'; isolate and host error strings as implemented | user | accepted |
| D-0182 | Content migrated on editor load is the unsaved-changes baseline (status unchanged until an edit); the next save persists it | user | accepted |
| D-0183 | Migration tests: fixture theme test/fixtures/migrations and suite test/migrations.test.ts; theme-switching artifact tests publish with force | user | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Page caching (D-0149).** Three options:
  - a core page cache in the `CacheStore`, plus CDN headers;
  - Next `'use cache'` + `revalidateTag`, which needs `cacheComponents`, a custom handler for clusters, and keeping nonces out of the cached part;
  - both.

  The owner was unsure whether HTML should be cached at all, or only data. The decision was to postpone and measure.
- **Preview links (D-0118).** Signed, expiring tokens with no storage, or stored tokens, which can be revoked but which every adapter would have to implement. Signed tokens won.
- **Restore in the contract or in the core (D-0122).** The core does it by reading the old revision and saving it as a new draft, which keeps adapters smaller.
- **Conflict signalling (D-0123, D-0150).** A return-value union, or a thrown error class. The union was chosen: it is explicit across package boundaries.
- **Legacy pages (D-0120).** A legacy reader, or a direct conversion. The owner chose direct conversion; this is pre-1.0 and has no external users.
- **sdkMajor bump (D-0143).** Either make `__migrate` optional, or bump. A bump keeps the wire contract strict, and rebuilding the theme is cheap.

### Rationale
- Optimistic concurrency, with `publish` limited to the current draft, prevents both lost updates and publishing changes nobody has seen.
- Preview access is a separate action (`page:preview`), because sharing a draft outside the editor is a different permission from reading it.
- The data cache is already where most of the time is saved (backend fetches), so HTML caching can wait for load-test numbers.

### Trade-offs Accepted
- `pages-fs` is single-instance only.
- Preview tokens can only be revoked by rotating the secret.
- Older artifacts must be rebuilt (sdkMajor 2).
- Pages are rendered on every request until a caching decision is made.

## Implementation
### Public API / config changes
- **Slice A:**
  - `@puck-remote/sdk/host`: `PageStore` v2, plus `Revision`, `PageRevision`, `PageMeta` and `WriteResult`.
  - `@puck-remote/pages-fs`: `fsPageStore({ dir, maxRevisions })`, with `FsPageStoreOptions` exported.
  - `pageStoreContract` rewritten.
- **Slice B:**
  - `Action` gains `page:delete` and `page:preview`.
  - New API routes: `pages`, `pages/save|publish|unpublish|delete|history|revision|restore`. The old `POST pages` is removed.
  - `EditorProps.page` added.
  - Core internals: `authenticateRequest` and `authorizePrincipal` split out of `authorizeRequest`; `pages.ts` gains `readPublished`, `readDraft`, `cleanPage`, `saveDraft`, `PAGE_SCHEMA_VERSION` and `PageFormatError`.

- **Slice D:**
  - config `preview { secret, ttlSeconds }` (`HostConfig.preview`);
  - `PageContext.preview` and `PreparedPage.preview`;
  - route `pages/preview-link`;
  - `EditorProps.previewEnabled`;
  - `PREVIEW_PARAM` exported from `@puck-remote/core/edge`;
  - `server/preview.ts` (token create/verify);
  - the Next proxy sets no-store/noindex for previews;
  - the demo app uses `PUCK_REMOTE_PREVIEW_SECRET`.
- **Slice E:**
  - `defineBlock`/`defineRoot` accept `version` and `migrations`.
  - SDK constants: `SDK_MAJOR` is now 2, and `FUNCTION_KEYS` gains `migrations`.
  - Runtime: new `__migrate` entry point; the manifest `BlockMeta.version` is required.
  - Core: `server/migrate.ts` (`migratePage`, `stampVersions`, `VERSION_PROP`) and `EditorProps.migrationErrors`.
  - CLI: `build({ baseline })` with `--baseline`, `publish({ force })` with `--force`, and the `checkBaseline` helper.
  - Example theme: `quote` is now v2.
- **Slice C:** the editor header (`editor/workflow.tsx`) replaces Puck's Publish button; `EditorClient` uses Puck `onChange` and stable `OVERRIDES`.

### Docs pages touched
- **Slice A:** `core/adapters/page-store.mdx`, `core/adapters/testing.mdx`.
- **Slice B:**
  - `(framework)/http-api.mdx`
  - `core/adapters/auth.mdx`
  - `internal/architecture/{auth-and-csrf,editor-lifecycle,public-request}.mdx`
  - `internal/quality/testing.mdx`
- **Slice C:**
  - new `(framework)/guides/publishing.mdx`, placed before "Deploying safely";
  - `(framework)/concepts/editor.mdx`;
  - `internal/architecture/editor-lifecycle.mdx`.
- **Slice D:**
  - `(framework)/{configuration,environment,http-api}.mdx`;
  - `(framework)/next-js/api.mdx`;
  - `(framework)/guides/publishing.mdx` (preview section);
  - `core/entry-points.mdx`;
  - `internal/architecture/{public-request,editor-lifecycle}.mdx`;
  - `internal/quality/testing.mdx`.

- **Slice E:**
  - new `sdk/migrations.mdx`;
  - `sdk/{blocks,manifest}.mdx`;
  - `cli/{commands,programmatic-api}.mdx`;
  - `internal/architecture/{build-pipeline,isolate-runtime,worker-protocol,public-request,editor-lifecycle}.mdx`;
  - `internal/quality/testing.mdx`.

## Investigation Notes
- Next 16 replaces the proxy's `cache-control: private, no-store` with `no-store` on dynamic pages (D-0175).
- Puck 0.23 exposes `useGetPuck()` (current data, `dispatch({ type: 'setData' })`) and an `onChange` prop. Both are used by the workflow header.


## Challenges & Solutions
- **Header state lost on edits.**
  - Symptom: the History panel closed while typing.
  - Cause: the `headerActions` override was an inline function, so Puck remounted it on every edit and reset its state.
  - Fix: a stable module-level override fed by React context (D-0167, agent-unreviewed).
- **Mislabeled decision.** D-0166 was recorded as `user` by mistake, and D-0167 supersedes it.
- **Missing local launch config.** The docs-branch commit untracked `.claude/launch.json` (it is gitignored), so it was restored locally from history.

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
[Tests, results, review notes]

## Outcome & Lessons
[Final results and lessons learned]

## Tags
pages editor migrations preview roadmap
