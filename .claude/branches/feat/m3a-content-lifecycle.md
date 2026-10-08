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
[New or changed exports, options and defaults: each one is a decision]

### Docs pages touched
[apps/docs/content/docs/...]

[Key changes, files, testing, migration plan]

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
pages editor migrations preview roadmap
