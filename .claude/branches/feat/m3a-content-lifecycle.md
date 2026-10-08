---
title: "M3a: content lifecycle, then simplification to remote components + Shopify-like themes"
description: "Built drafts, publishing, preview links and migrations, then (owner redirection) reduced the core to loading remote components, merged pages into hash-addressed artifacts and moved the editor to a credential-free iframe"
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


### Redirection (second plan, D-0186–D-0209)
After slices A–F, the owner judged the feature out of the original scope: the core should only
**load custom components from a remote artifact and render them**. Revisions, drafts, preview
links, migrations and the query cache leave the core. Pages move into the theme artifact, as in a
Shopify theme (templates live with the sections), so code and content are versioned together and
migrations disappear. Saving and publishing become plugins on two primitives (`readPage`,
`writePage`) and the artifact pointer. The editor becomes a static, credential-free app on its own
site, embedded by the host's admin page through a typed postMessage protocol; theme components run
as real client components in it.

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
| D-0118 | Preview links are signed, expiring tokens; the draft revision renders with draft data | user | superseded by D-0190 |
| D-0119 | Editor M3a scope: workflow basics (save draft, publish, status, conflict, history/restore, preview link), no autosave | user | superseded by D-0190 |
| D-0120 | No legacy page-format reader; the repo's demo pages are converted directly | user | superseded by D-0188 |
| D-0121 | Commit slicing A–F (contract+fs, core API+auth, editor UI, preview, migrations, top-level docs); each commit updates its docs | user-approved-plan | superseded by D-0186 |
| D-0122 | PageStore v2 contract: list, meta, getDraft, getPublished, getRevision, saveDraft, publish, unpublish, delete, history; opaque store-generated revisions; restore done by the core | user-approved-plan | superseded by D-0188 |
| D-0123 | Optimistic concurrency: saveDraft needs the current draft as baseRevision (null = create), publish only accepts the current draft; conflicts are return values | user-approved-plan | superseded by D-0188 |
| D-0124 | Each page revision carries schemaVersion (core page format, starts at 1); higher versions are rejected; internal upgrade registry | user-approved-plan | superseded by D-0188 |
| D-0125 | Revision author is the authenticated Principal.id (optional) | user-approved-plan | superseded by D-0187 |
| D-0126 | pages-fs v2 layout: <slug>/revisions/<n>.json (zero-padded counter = revision id) + <slug>/meta.json, temp+rename, revision before meta | user-approved-plan | superseded by D-0188 |
| D-0127 | pages-fs concurrency: in-process per-slug mutex; documented as single-instance only | user-approved-plan | superseded by D-0188 |
| D-0128 | pages-fs keeps maxRevisions (default 100); never prunes the current draft or published revision | user-approved-plan | superseded by D-0188 |
| D-0129 | Demo pages converted to the new layout, each published as revision 1 | user-approved-plan | superseded by D-0188 |
| D-0130 | Page API routes: GET pages, POST pages/save\|publish\|unpublish\|delete\|restore\|preview-link, GET pages/history\|revision; 409 on conflicts | user-approved-plan | superseded by D-0190 |
| D-0131 | New actions page:delete and page:preview | user-approved-plan | superseded by D-0187 |
| D-0132 | Every page route passes { slug } as the authorize resource | user-approved-plan | superseded by D-0187 |
| D-0133 | History limit default 20, max 100; invalid values are a 400 | user-approved-plan | superseded by D-0190 |
| D-0134 | Public render and pageCacheability read the published revision (none = 404); editor reads the draft; EditorProps gains page meta and previewEnabled | user-approved-plan | superseded by D-0190 |
| D-0135 | Save pipeline: validate, restoreMissing, stripResolved, stamp __v, saveDraft | user-approved-plan | superseded by D-0190 |
| D-0136 | Editor header replaces Puck's Publish: Save draft, Publish (saves first), status badge, History panel with Restore, Copy preview link | user-approved-plan | superseded by D-0190 |
| D-0137 | Conflict banner with Reload and Overwrite | user-approved-plan | superseded by D-0190 |
| D-0138 | beforeunload prompt when there are unsaved changes | user-approved-plan | superseded by D-0190 |
| D-0139 | Preview token: base64url(JSON{s,r,e}).base64url(HMAC-SHA256) via Web Crypto; config preview { secret, ttlSeconds } (default 24 h, max 30 days); off without config; production secret >= 32 bytes | user-approved-plan | superseded by D-0190 |
| D-0140 | Preview delivery: ?puck_preview=<token> on the site origin; no-store + noindex; invalid = 404; param hidden from $query | user-approved-plan | superseded by D-0190 |
| D-0141 | PageContext.preview; Next loadPage reads puck_preview; proxy adds no-store/noindex when present; revocation = rotate secret | user-approved-plan | superseded by D-0190 |
| D-0142 | defineBlock/defineRoot accept version (default 1) and migrations keyed N (N-1 -> N); every step required; items carry props.__v (missing = 1) | user-approved-plan | superseded by D-0188 |
| D-0143 | New __migrate isolate entry point (slots detached and reattached by the host, output validated); sdkMajor bumped 1 -> 2 | user-approved-plan | superseded by D-0188 |
| D-0144 | Migrations run on public render (not persisted) and in loadEditor; save stamps missing __v with the current version | user-approved-plan | superseded by D-0188 |
| D-0145 | Migration failure fails only that block (public) or keeps unmigrated props with a warning (editor); newer __v renders unmigrated with a warning | user-approved-plan | superseded by D-0188 |
| D-0146 | build --baseline <manifest> compares field shape (names, types, nested fields, option values) and fails on unbumped changes or version decrease; also build({ baseline }) | user-approved-plan | superseded by D-0188 |
| D-0147 | publish checks against the active artifact and refuses unless --force | user-approved-plan | superseded by D-0188 |
| D-0148 | Example theme: quote v2 renames author to cite with a migration; demo data stays v1 | user-approved-plan | superseded by D-0188 |
| D-0149 | Rendered-page/HTML caching postponed to post-V1; M3 keeps only the tagged query-result cache; what to cache is decided later from M5 load tests | user-approved-plan | superseded by D-0187 |
| D-0150 | A conflicting write on a missing page returns meta: null (WriteResult conflict meta is PageMeta \| null) | user | superseded by D-0188 |
| D-0151 | pages-fs revision ids are 8-digit zero-padded counters | user | superseded by D-0188 |
| D-0152 | pages-fs exports its options type as FsPageStoreOptions ({ dir, maxRevisions }) | user | superseded by D-0188 |
| D-0153 | API order: CSRF, authenticate (401), parse (400), authorize with { slug } (403), handler; blocks/resolve and blocks/render pass their slug too | user | superseded by D-0187 |
| D-0154 | Newer page format: PageFormatError ('page <slug> uses page format <n>; this version of puck-remote reads up to <max>'), HTTP 500 in the editor API, propagated on public render | user | superseded by D-0188 |
| D-0155 | Invalid GET query strings on the API return 400 'invalid query' | user | superseded by D-0190 |
| D-0156 | unpublish of a missing page is 404; delete is idempotent (200 { ok: true }) | user | superseded by D-0190 |
| D-0157 | handleApi fails closed if a handler returns (other than 400) without authorizing | user | superseded by D-0187 |
| D-0158 | A never-saved page shows the status 'Unsaved changes' | user | superseded by D-0190 |
| D-0159 | Restore with unsaved changes asks 'Discard your unsaved changes and restore this revision?'; the restored draft is loaded into the editor | user | superseded by D-0190 |
| D-0160 | History is a dropdown panel with the 20 newest revisions (date, author, published/draft markers) and 'Load more' | user | superseded by D-0190 |
| D-0161 | Publish is disabled when nothing is unsaved and the draft is already published, and while a request runs | user | superseded by D-0190 |
| D-0162 | History disables Restore on the row that is already the current draft | user | superseded by D-0190 |
| D-0163 | Editor status messages: Saved/Published HH:MM:SS, Restored revision <id>, <Action> failed (<status>); empty history 'No revisions yet.' | user | superseded by D-0190 |
| D-0164 | History rows without an author show an em dash | user | superseded by D-0190 |
| D-0165 | 'Unsaved changes' compares editor data ignoring __data and readOnly keys | user | superseded by D-0190 |
| D-0166 | Editor header overrides are a stable component fed by React context (Puck remounts overrides whose identity changes) | user | superseded by D-0167 |
| D-0167 | Editor header overrides are a stable component fed by React context (Puck remounts overrides whose identity changes); D-0166 was mislabeled as user-approved | agent-unreviewed | superseded by D-0190 |
| D-0168 | Copy preview link saves unsaved changes first, then links that revision | user | superseded by D-0190 |
| D-0169 | Preview link is copied to the clipboard with status 'Preview link copied (expires <date time>)'; without clipboard access it is shown in a prompt | user | superseded by D-0190 |
| D-0170 | preview config errors: 'preview.secret must be at least 32 bytes in production'; 'preview.ttlSeconds must be an integer between 60 and 2592000 (30 days)' (60 s minimum) | user | superseded by D-0190 |
| D-0171 | Demo app: random preview secret per process in development; production requires PUCK_REMOTE_PREVIEW_SECRET | user | superseded by D-0184 |
| D-0172 | @puck-remote/core/edge exports PREVIEW_PARAM ('puck_preview'); PreparedPage.preview flag; preview config accepts null (off) | user | superseded by D-0190 |
| D-0173 | preview-link returns 404 when previews are off or the revision is missing (after auth); relative URL without origins; tokens over 2048 chars rejected | user | superseded by D-0190 |
| D-0174 | Demo app: 'PUCK_REMOTE_PREVIEW_SECRET is required in production'; clipboard fallback prompt 'Preview link'; status 'Preview link failed (<status>)' | user | superseded by D-0190 |
| D-0175 | Preview responses end up 'no-store' (Next replaces the proxy's 'private, no-store' on dynamic pages); accepted and documented | user | superseded by D-0185 |
| D-0176 | Migration functions take untyped Record<string, unknown> props and return a plain object; the host keeps id, reattaches slots, drops __ keys; one __migrate call per outdated item in the page session, before data resolution | user | superseded by D-0188 |
| D-0177 | Editor surfaces failed migrations via EditorProps.migrationErrors and the status 'Migration failed: <blocks>' | user | superseded by D-0188 |
| D-0178 | build({ baseline: path }); messages 'block "x": fields changed without a version bump (still vN); bump "version" and add a migration', 'block "x": version went down (a → b)'; publish adds '(compared with the active artifact vN; use --force to publish anyway)'; publish({ force }) | user | superseded by D-0188 |
| D-0179 | A failed public migration renders like a failed block render (empty, counted, logged as 'failed (migration)'); its data isn't fetched | user | superseded by D-0188 |
| D-0180 | Build errors for versions/migrations: 'must be an integer >= 1', 'missing migration from version N-1 to N', 'unexpected key: migrations go from 2 to version (V)', 'must be an object of functions keyed by version' | user | superseded by D-0188 |
| D-0181 | Migration runtime texts: '[migrate] <block>#<id> was saved with version N, newer than the theme's M; rendering it as is'; isolate and host error strings as implemented | user | superseded by D-0188 |
| D-0182 | Content migrated on editor load is the unsaved-changes baseline (status unchanged until an edit); the next save persists it | user | superseded by D-0188 |
| D-0183 | Migration tests: fixture theme test/fixtures/migrations and suite test/migrations.test.ts; theme-switching artifact tests publish with force | user | superseded by D-0188 |
| D-0184 | Demo app: production without PUCK_REMOTE_PREVIEW_SECRET leaves previews off (next build evaluates the config, so throwing broke builds); development keeps a random per-process secret | user | superseded by D-0190 |
| D-0185 | Correction: preview responses keep 'private, no-store' in production; only next dev rewrites it to 'no-store' (D-0175 described dev behavior) | agent-unreviewed | superseded by D-0190 |
| D-0186 | Simplification is done on top of M3a (same branch and ADR); commit slicing A (contracts+store), B (CLI), C (protocol+frame+bridge), D (apps), E (docs+ADR) | user | superseded by D-0220 |
| D-0187 | Core scope: artifact loading, isolate SSR, Puck editor integration and declarative data queries; query cache, auth/CSRF and surface routing leave core | user | accepted |
| D-0188 | Shopify-like themes: page JSON lives in the artifact; the page store and artifact store are merged; no content migrations | user | accepted |
| D-0189 | Core treats an artifact id as an opaque string; the ArtifactStore decides what it means (artifacts-fs: content hash of code + pages) | user | accepted |
| D-0190 | Save, publish, drafts and revisions are plugins, not core; core only reads and writes pages | user | accepted |
| D-0191 | Public site keeps isolate SSR (worker pool unchanged) | user | accepted |
| D-0192 | Editor is a static, credential-free app on its own site running full Puck; the host passes theme content (pages, manifest, bundle and asset URLs) by postMessage and the iframe rebuilds the Puck config; theme components run as client components in the editor | user | accepted |
| D-0193 | Host embed <PuckEditorFrame>: editorUrl/editorOrigin, initial data, JSON-only options, allow-listed RPC handlers, onChange/onDraft; publish lives in host UI; checks e.origin and e.source; explicit targetOrigin | user | superseded by D-0209 |
| D-0194 | Typed, versioned postMessage protocol (ready, init, change, rpc, rpc:result, error); RPC for resolveData, fetchList, media pickers, uploads; page id from host state; no generic fetch; size and rate limits | user | accepted |
| D-0195 | Editor responds frame-ancestors <host origin>; host page frame-src <editor origin>; server validates and sanitizes page data on write | user | accepted |
| D-0196 | artifacts-fs id = sha256 over sorted '<path>\0<sha256(file)>\n' lines of every file (full hex); core keeps verifying code files against manifest.files; pages are not in manifest.files | user-approved-plan | superseded by D-0206 |
| D-0197 | ArtifactStore: readPointer(): string\|null, writePointer(id), list(), readFile(id, path), writeArtifact(files) -> id (store-generated), optional watch; core checks ids match [A-Za-z0-9._-]{1,128}; fs layout <dir>/<id>/ + current.json {id}; identical content returns the existing id; theme URLs /theme/<id>/ | user-approved-plan | accepted |
| D-0198 | Core page API: readPage(slug, { artifact? }) and writePage(slug, data, { base }) -> { id }; writePage copies the base artifact, replaces pages/<slug>.json (validated, cleaned) and never moves the pointer; the demo app ships a 'save = write + go live' plugin | user-approved-plan | accepted |
| D-0199 | Theme source pages in <theme>/pages/<slug>.json copied into the artifact by build (unknown block = build error); new 'puck-remote pull' downloads the current artifact's pages; publish uploads code + pages as in the repo; demo pages move to examples/theme/pages | user-approved-plan | accepted |
| D-0200 | build also emits bundle.browser.js (ESM, react and @puck-remote/sdk external, provided by the editor via an import map); bundle.js unchanged; served from /theme/<id>/ with CORS for the editor origin | user-approved-plan | accepted |
| D-0201 | New @puck-remote/editor package (/protocol, /frame, /bridge) and apps/editor static SPA built with esbuild; dev editor http://127.0.0.1:3300, host http://localhost:3100 | user-approved-plan | superseded by D-0221 |
| D-0202 | Core exports resolveBlockData(slug, block, props) (draft mode) for the resolveData RPC handler; apps write other handlers and wrap all with their own auth; Next createEditorRpcRoute(handlers) only dispatches and limits size | user-approved-plan | accepted |
| D-0203 | Limits: RPC payload 1 MB (uploads 10 MB), 20 RPC/s per frame, change debounce 500 ms, page JSON 2 MB | user-approved-plan | accepted |
| D-0204 | Keep a reduced origins { site, admin } check (admin pages with the editor frame and publish refuse site origins) and the public-page CSP; the old editor surface is dropped | user-approved-plan | superseded by D-0207 |
| D-0205 | Keep pageCacheability (pages using $query params -> no-store, D-0012); it is a correctness flag, not the query cache | user-approved-plan | accepted |
| D-0206 | Pages are listed in manifest.files (pages/<slug>.json → sha256) and verified like every other file; writePage rewrites manifest.json; artifacts-fs id = sha256 over sorted '<path>\0<sha256(file)>\n' lines of every file | user | accepted |
| D-0207 | Core config origins { admin: string[], editor: string } (no site origin); core rejects an editor origin equal to an admin origin; PuckEditorFrame checks it runs on an admin origin and the bridge checks it runs on the editor origin; theme route answers CORS for the editor origin | user | accepted |
| D-0208 | core.editorPayload(slug, { artifact? }) returns { artifact, slug, manifest, data, bundleUrl, assetBase }; the host page passes it to <PuckEditorFrame> which sends it in init with the options | user | accepted |
| D-0209 | No 'draft' message: <PuckEditorFrame> exposes onChange(data) only (every validated change); props editorUrl/editorOrigin, initial payload, JSON-only options, allow-listed RPC handlers; publish lives in host UI; checks e.origin and e.source; explicit targetOrigin | user | accepted |
| D-0210 | Editor protocol API names: PROTOCOL_VERSION, LIMITS, measure(), rateLimiter(), EditorOptions { permissions, locales, categories (replaces the theme's), flags, extra }; frame helpers frameProblem/hostMessageHandler; bridge startEditorBridge/initProblem; EditorPayload gains site | agent-unreviewed | needs-review |
| D-0211 | PuckEditorFrame renders the iframe only after its origin checks, with sandbox='allow-scripts allow-same-origin allow-forms allow-popups' and referrerPolicy no-referrer | agent-unreviewed | needs-review |
| D-0212 | SDK exports SlotContext; <Slot> renders the editor-provided Puck slot when the context is set, the nonce marker otherwise | agent-unreviewed | needs-review |
| D-0213 | Next bindings: loadPage 404s on admin origins, loadEditor 404s outside them; createEditorRpcRoute is a PuckRemote method checking Origin and request origin against origins.admin (404), 1 MB body (413), unknown method 404; loginUrl option removed | agent-unreviewed | needs-review |
| D-0214 | Editor app: esbuild build.mjs, import map to generated vendor shims re-exporting modules the app puts on globalThis.__puckRemoteModules; serve.mjs with CSP (import map by hash) and frame-ancestors from PUCK_REMOTE_ADMIN_ORIGINS; HOST/PORT env | agent-unreviewed | superseded by D-0223 |
| D-0215 | Example app: admin page at /admin (admin.localhost:3100 in dev), RPC route /api/editor-rpc with resolveData and publish (save = write + go live, refuses a stale base); app-level isAdmin with PUCK_REMOTE_ADMIN_TOKEN; env PUCK_REMOTE_ADMIN_ORIGINS, PUCK_REMOTE_EDITOR_ORIGIN, PUCK_REMOTE_EDITOR_URL | agent-unreviewed | needs-review |
| D-0216 | Core API details: readPage returns { artifact, data }; PageError, UnknownBlockError, MAX_PAGE_BYTES exported; artifacts-fs exports artifactHash; theme route sends CORP cross-origin with CORS when origins are set; security.csp.editor renamed security.csp.admin | agent-unreviewed | needs-review |
| D-0217 | pull overwrites pulled page files and leaves other local files; page validation allows zones; the demo home page drops its old-banner item (unknown blocks now fail the build) | agent-unreviewed | needs-review |
| D-0218 | Docs structure: concepts/surfaces-and-origins becomes concepts/origins; guides/publishing becomes 'Pages and publishing'; new guides/editor-app and internal/architecture/editor-protocol; page-store, cache, auth, migrations and auth-and-csrf pages removed | agent-unreviewed | needs-review |
| D-0219 | Error and status wording as implemented (PageError, frame/bridge problems, RPC errors, build page errors, demo status messages) | agent-unreviewed | needs-review |
| D-0220 | Simplification is done on top of M3a (same branch and ADR) in two commits: the redirection, then the editor as a package; each carries its docs and ADR (the docs/ADR hook requires both per commit) | user-approved-plan | accepted |
| D-0221 | @puck-remote/editor ships the built static editor (dist/static: index.html, app.js, app.css, vendor shims; React, react-dom and Puck bundled at package build); /frame and /bridge keep them as peers; apps/editor is removed | user-approved-plan | accepted |
| D-0222 | Admin origins are injected at runtime into index.html as a JSON data block (script type application/json, id puck-remote-editor-config) read by the bridge; CSP stays hash-only for the import map | user-approved-plan | accepted |
| D-0223 | @puck-remote/editor/server: createEditorHandler({ adminOrigins, basePath? }) reads dist/static with fs (once, in memory); Request->Response; GET/HEAD; /, /index.html, /app.js, /app.css, /vendor/*.js, else 404; editor CSP with frame-ancestors, no-referrer, nosniff, COOP; no cookies; hashed asset URLs immutable, index no-store; throws on empty adminOrigins | user-approved-plan | accepted |
| D-0224 | Bin puck-remote-editor in @puck-remote/editor: --port (3300), --host (127.0.0.1), --admin-origins (comma list, env PUCK_REMOTE_ADMIN_ORIGINS fallback, required) | user-approved-plan | accepted |
| D-0225 | Next.js: core routes.editor (default /editor) and remote.editor ({ GET, HEAD }) for app/editor/[[...path]]/route.ts; the proxy rewrites every path on origins.editor to <routes.editor><path> and answers 404 for <routes.editor>/** elsewhere; withPuckRemote externalizes @puck-remote/editor | user-approved-plan | accepted |
| D-0226 | Example host serves the editor itself; dev editor origin http://127.0.0.1:3100 (same app, another site than admin.localhost:3100); launch.json loses its editor entry | user-approved-plan | accepted |
| D-0227 | Editor server tests: page and config injection, CSP hash and frame-ancestors, no set-cookie, 404/405, traversal, empty admin origins; the Next proxy is verified in the browser | user-approved-plan | accepted |
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


### Options considered in the redirection
- **Base (D-0186).** A new branch from `main`, or stripping on top of M3a. The owner chose to
  strip on top of M3a.
- **Merged store (D-0188, D-0189, D-0206).** A git-like object store (blobs, snapshots, refs), or
  artifacts addressed by an id the store chooses. The owner wanted the artifact id to be the hash
  of its content "like a commit", but specific to the fs store; the core keeps ids opaque. Pages
  are listed in `manifest.files` (owner) rather than a separate index or a `listFiles` contract
  method.
- **Edit model (D-0190, D-0198).** Every save creates an artifact, a mutable draft theme, or
  pages written in place. The owner put save/publish outside core: the core only writes a page
  into a copy of a base artifact and never moves the pointer.
- **Editor (D-0192, D-0208).** A generic editor app loading the theme's browser bundle at runtime,
  or a per-theme editor built by the CLI. The owner chose a generic editor that receives the theme
  content (pages, manifest, bundle and asset URLs) by postMessage and rebuilds the Puck config.
- **Origins (D-0207).** On the Next bindings or in core. The owner kept them in core, without a
  site origin: admin and editor origins, checked by the core and by both sides of the frame.
- **Draft message (D-0209).** Dropped: `change` only.
- **React sharing (D-0200).** An import map (chosen) or window globals.

### Rationale of the redirection
- Shipping pages with their code removes the class of problems migrations solved: a page can no
  longer outlive the fields it was made for.
- A credential-free editor on another site gives the protection the server-rendered canvas gave,
  while letting blocks be real client components (native drag and drop, and inline/rich text
  later).
- Keeping auth, caching and workflows in the app makes the core small and lets each host decide.

### Rationale (slices A–F)
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


### Redirection: public API / config changes
- `@puck-remote/sdk/host`: `PageStore`, `CacheStore`, `AuthAdapter`, actions and `DataSource.subscribe`/`tags` removed; `ArtifactStore` uses string ids (`list`, `writeArtifact(files) → id`); `ArtifactId`. SDK: `version`/`migrations` removed, `SlotContext` added, `SDK_MAJOR` 3.
- `@puck-remote/core`: `readPage`, `writePage`, `editorPayload`, `resolveBlockData`, `handleTheme` (`/theme/<id>/assets/**`, `/theme/<id>/bundle.browser.js`, CORS for the editor); config `origins { admin, editor }`; removed `pages`, `cache`, `auth`, `preview`, `allowedOrigins`, `routes.api`, `routes.editor`, `http.cacheTtlMs`, `handleApi`, `loadEditor`, `/editor` entry, `memoryCache`, auth helpers, surface classification; testing kit is `artifactStoreContract` only.
- `@puck-remote/artifacts-fs`: content-hash ids, `artifactHash`. `@puck-remote/pages-fs` removed.
- `@puck-remote/cli`: pages in the build, `bundle.browser.js`, `BROWSER_EXTERNALS`, `pull`, `publish → { id }`, `activate(id)`; `--baseline`/`--force` removed.
- New `@puck-remote/editor` (`/protocol`, `/frame`, `/bridge`) and `apps/editor`.
- `@puck-remote/next`: `loadEditor → EditorPayload`, `createEditorRpcRoute`, proxy by origin; `api`, `EditorClient`, `loginUrl` removed.

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

### Redirection: docs pages touched
Framework: index, installation, quick-start, concepts (artifacts, editor, origins (renamed), trust-model, adapters, declarative-data, blocks-and-isolate), next-js (index, api), guides (publishing → Pages and publishing, new editor-app, deploying, other-frameworks, payload, theme-development), configuration, environment, http-api, security-headers. Core: index, entry-points, adapters (index, artifact-store, data-source, testing; page-store, cache, auth removed). CLI: all pages. SDK: index, blocks, fields, context, manifest, host-contracts; migrations removed. Internal: threat-model, public-request, editor-lifecycle, new editor-protocol, artifact-loader, build-pipeline, isolate-runtime, worker-protocol, query-resolver, missing-blocks, slot-swap, packaging, testing, known-gaps, contributing/docs; auth-and-csrf removed.

## Investigation Notes
- Under `next dev`, Next 16 rewrites the proxy's `cache-control: private, no-store` to `no-store`. `next start` keeps it. D-0175 had described the dev behavior as general; D-0185 corrects it.
- Puck 0.23 exposes `useGetPuck()` (current data, `dispatch({ type: 'setData' })`) and an `onChange` prop. Both are used by the workflow header.


## Challenges & Solutions
- **Header state lost on edits.**
  - Symptom: the History panel closed while typing.
  - Cause: the `headerActions` override was an inline function, so Puck remounted it on every edit and reset its state.
  - Fix: a stable module-level override fed by React context (D-0167, agent-unreviewed).
- **Mislabeled decision.** D-0166 was recorded as `user` by mistake, and D-0167 supersedes it.
- **`next build` evaluates the app config.** The approved production throw on a missing preview secret (D-0171) broke `next build`. The owner chose to leave previews off instead (D-0184).
- **Missing local launch config.** The docs-branch commit untracked `.claude/launch.json` (it is gitignored), so it was restored locally from history.

## Impact Assessment
- **Breaking changes (pre-1.0):**
  - `PageStore` contract v2 and the `pages-fs` layout;
  - API routes: `POST pages` is replaced by `pages/*`;
  - `sdkMajor` 2, so artifacts must be rebuilt.
- **Security:**
  - publish, delete and preview are new actions, and every page action is authorized per slug;
  - handlers fail closed when they forget to authorize;
  - preview links are bearer tokens (see the threat model).
- **Performance:** a migration costs one isolate call per outdated item, inside the page's existing session. Nothing changes for up-to-date pages.

## Quality Assurance
- **Tests:**
  - core: 132 passed, 1 skipped (bubblewrap on macOS);
  - CLI: 10 passed.
  - The worker watchdog test failed once while the dev server was compiling in parallel, then passed 3 of 3 alone (timing flakiness under load; unchanged).
- **Checks:** typecheck, `lint:pkg`, `docs:build` and `next build` are clean.
- **Live in dev:**
  - save draft while the site keeps the published version, then publish;
  - a conflict from a second client, with the banner, then Overwrite;
  - History with Load more (25 revisions), and Restore with the confirm prompt;
  - Copy preview link: saves first, then the link renders the draft (no-store, noindex); tampered, other-slug and editor-origin links give 404;
  - the migrated quote renders on the site, and the editor holds `__v: 2`.
- **Production (`next start`):**
  - publish without auth gives 401;
  - history with a bearer token works;
  - the preview link works (`private, no-store`, noindex), and a tampered one gives 404;
  - a short secret gives 500 with the config error;
  - without a secret, previews are off (404).

### Redirection QA
- **Tests:** core 88 passed, 1 skipped (bubblewrap on macOS); CLI 12 passed; editor 9 passed.
  New: artifacts-fs hash determinism and dedupe, a counter-id store through the core, page tamper
  rejection, `writePage` (new id, pointer untouched, cleaning), editor parity (browser bundle +
  Puck slots vs isolate render), protocol (origin/source/version/size/rate), build pages and pull.
- **Checks:** build, typecheck, `lint:pkg`, `docs:build` clean.
- **Live in dev** (host 3100, editor 127.0.0.1:3300, mock API): the admin page on
  `admin.localhost:3100` embeds the editor; Puck renders theme components with theme CSS and draft
  data from the `resolveData` RPC; deleting a block and publishing stored a new artifact, moved the
  pointer and the public site served it; publishing unchanged content returned the same id;
  public pages 404 on the admin origin and `/admin` 404s on the site; the editor app sends
  `frame-ancestors http://admin.localhost:3100`; the theme route answers CORS for the editor only
  and never serves `bundle.js` or pages.

### Editor as a package (third plan, D-0220–D-0227)
The owner wanted the editor installable, not an example app: `@puck-remote/editor` now ships the
built editor (`dist/static`) and serves it three ways: `createEditorHandler` (`/server`) in any
process, the `puck-remote-editor` bin, and the Next.js app itself (`remote.editor` route +
proxy rewrite of `origins.editor`), so one deployment answers the site, admin and editor origins.
Options: embedding the files in the server module (works in the bundled proxy and edge runtimes)
or reading them with `fs` from a route handler; the owner chose the route handler with `fs` and
the proxy only routing by origin. Admin origins moved from build time to a runtime JSON block.
`apps/editor` was removed; the example's dev editor origin is `http://127.0.0.1:3100`.

QA: editor 16 tests (server + protocol); bin serves the page with CSP and injected origins;
in the browser, with only the host app running, `admin.localhost:3100/admin` embeds
`127.0.0.1:3100/` (full Puck, theme components, draft data) and publishing works; on the editor
origin `/admin`, `/api/editor-rpc` and `/theme/**` return the editor's 404; `/editor` returns 404
on the site and admin origins. During this work the local `artifacts/` lost `current.json`, the old
`v1`–`v7` folders and `.gitkeep` for an unidentified reason; the theme was re-published and
`.gitkeep` restored.

## Outcome & Lessons
M3a delivered:
- the publishing workflow (drafts, publish, history, restore, conflicts) in the PageStore contract, the API and the editor;
- signed preview links;
- content migrations with build and publish checks.

Lessons:
- Many small choices surfaced during implementation: messages, edge cases, UI details. They were batched into questions instead of being picked silently.
- Two records needed correcting:
  - D-0166 had the wrong provenance; D-0167 supersedes it.
  - D-0175 described `next dev` behavior as general; D-0185 corrects it.
- Production builds evaluate the app config, so config-time throws must not depend on runtime-only secrets.

## Tags
pages editor migrations preview roadmap
