---
title: "M3b: Payload backend (source, artifact store, auth, admin plugin)"
description: "Payload as the first real backend: @puck-remote/payload (source, artifact store, auth, admin plugin with the editor in Payload admin), sources receive the actual request instead of a draft mode, and an examples/payload app."
---

# Branch ADR: feat/payload

## Meta
- **Branch**: feat/payload
- **Type**: feat
- **Created**: 2026-10-13
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved in session, 2026-10-12)
- **PR**: (not yet created)

## Problem Statement
### Context
Payload is the first real backend (D-0054); M3b holds the Payload adapters (D-0116). The artifact
upload API landed on feat/artifact-api. Sources received a host-chosen `mode` ('draft' for the
editor, D-0029/D-0202), but no user: with Payload's access control (`overrideAccess: false`) an
anonymous query never sees drafts, and a service account or `overrideAccess` would ignore per-user
rules. The owner asked that sources receive the actual request instead (no request = anonymous),
since drafts no longer exist for templates, and that the Payload plugin can preview as the
logged-in user or anonymously.

### Goals
- SourceContext carries the request; `mode` removed.
- `@puck-remote/payload`: DataSource, ArtifactStore, authorize helpers, Payload plugin with the
  editor and themes views in Payload's admin.
- `examples/payload` on SQLite, same theme, origins on :3300.

### Non-Goals
- Changing examples/app beyond the contract change (mock `canReadDrafts`).
- Localization (post-V1, D-0073), caching, history of theme files, uploads through Payload storage
  adapters.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0561 | M3b scope: Payload DataSource, ArtifactStore, auth helpers and an editor inside Payload's admin | user | accepted |
| D-0562 | One package @puck-remote/payload with subpaths /source, /artifacts, /auth, /plugin, /admin | user | accepted |
| D-0563 | New example app examples/payload; examples/app stays on the mock source and fs store | user | accepted |
| D-0564 | Payload plugin option previewAs 'user' \| 'anonymous' decides whether the editor preview queries as the logged-in user or anonymously | user | accepted |
| D-0565 | Payload source reads Payload drafts (draft: true) only for the editor-as-user case; anonymous previews and public pages read published content | user | accepted |
| D-0566 | Core API: prepareTemplate and resolveBlockData accept { request? }, forwarded to the source | user-approved-plan | accepted |
| D-0567 | Next: loadTemplate passes the incoming request rebuilt from headers(); remote.currentRequest() helper for server actions | user-approved-plan | accepted |
| D-0568 | Mock source: mockCms({ canReadDrafts?: (request) => boolean \| Promise<boolean> }); _status draft docs visible only when it returns true; examples/app passes its admin-session check | user-approved-plan | accepted |
| D-0569 | Resolver dedupe key drops mode (dedupe is per pass, one request per pass) | user-approved-plan | accepted |
| D-0570 | @puck-remote/payload peers: payload ^3.90.2 and @puck-remote/core; /admin also @payloadcms/ui, next, react, @puck-remote/editor; dev @payloadcms/db-sqlite for tests | user-approved-plan | accepted |
| D-0571 | payloadSource<Config>()({ payload: () => Payload (lazy), collections, globals, draft? }); keys are Payload slugs; doc types from Payload's generated Config; fields declared explicitly as CollectionField and checked against the Payload config at first use (unknown field or relation target = error) | user-approved-plan | accepted |
| D-0572 | Payload source auth: payload.auth({ headers }) memoized per Request (WeakMap); every query overrideAccess: false with user (null when no request or no session) | user-approved-plan | accepted |
| D-0573 | Payload source default draft rule: draft true only when the user belongs to config.admin.user; overridable with the draft option | user-approved-plan | accepted |
| D-0574 | Query mapping: equals/in/contains as is, contains null dropped, gt/lt to greater_than/less_than, and/or, sort '-field', select { f: true }, depth, limit/page, pagination true; locale only with Payload localization; no query started when signal is aborted | user-approved-plan | accepted |
| D-0575 | findByID via payload.findByID with disableErrors: true (missing or forbidden = null) | user-approved-plan | accepted |
| D-0576 | Payload artifact store theme list: append-only collection puck-remote-theme-lists { seq unique, themes json }; insert conflict = ThemeConflictError; version String(seq), '0' when empty; keep the last 20 revisions | user-approved-plan | accepted |
| D-0577 | Payload artifact store files: collection puck-remote-theme-files { theme, path, data base64, size } with a compound unique index (theme, path); one row update per file; copy and delete by theme | user-approved-plan | accepted |
| D-0578 | Payload artifact store has no watch; the core polls readThemes every 2000 ms (D-0065) | user-approved-plan | accepted |
| D-0579 | Payload artifact store uses overrideAccess: true; its collections deny all REST/GraphQL access and are hidden in the admin | user-approved-plan | accepted |
| D-0580 | payloadAuthorize({ payload, can? }) returns AuthorizeApi; default can: any authenticated user of the admin user collection; anonymous always refused; payloadUser(payload, request) helper | user-approved-plan | accepted |
| D-0581 | CLI authenticates with Payload API keys (useAPIKey) through puck-remote.cli.ts headers 'users API-Key <key>'; docs and example only, no CLI change | user-approved-plan | accepted |
| D-0582 | puckRemotePlugin({ core: () => Promise<core> (lazy), editorUrl, previewAs = 'user', artifacts = true, access? (default any admin user) }) | user-approved-plan | accepted |
| D-0583 | Plugin admin views /admin/puck-remote (themes list: editor, preview link, publish, duplicate, rename, delete) and /admin/puck-remote/editor?theme=&previewPath= hosting PuckEditorFrame; nav link via afterNavLinks | user-approved-plan | accepted |
| D-0584 | Plugin endpoints under Payload /api: POST puck-remote/resolve-data, puck-remote/publish (expect, 409 = conflict), puck-remote/themes/:op; not Payload server functions | user-approved-plan | accepted |
| D-0585 | Plugin covers the admin origin only; editor frame page, public catch-all, /api/themes and theme/cdn routes stay app routes via @puck-remote/next | user-approved-plan | accepted |
| D-0586 | examples/payload: Next 16.4, (app)/(puck)/(payload) groups, @payloadcms/db-sqlite at data/payload.db, users (auth, API keys), posts (drafts), authors, global site, seed mirroring examples/app cms.json | user-approved-plan | accepted |
| D-0587 | examples/payload origins on port 3300 (admin.localhost admin, 127.0.0.1 editor, localhost site); proxy 404s /admin and Payload /api/** off host origins; /api/themes on host origins | user-approved-plan | accepted |
| D-0588 | examples/payload uses examples/theme; Register source type stays the mock's, checked by the example typecheck | user-approved-plan | accepted |
| D-0589 | Scripts pnpm --filter payload-example dev \| seed; one CLAUDE.md command row | user-approved-plan | accepted |
| D-0590 | Branch feat/payload from feat/artifact-api | user-approved-plan | accepted |
| D-0591 | Docs: guides/payload rewrite, core/adapters/payload (new), sdk/host-contracts, core/adapters/data-source, concepts/declarative-data and adapters, internal query-resolver, threat-model, known-gaps, testing, contributing map | user-approved-plan | accepted |
| D-0592 | Tests: payload source (mapping, per-user access, draft rule, anonymous, relation policy) on SQLite; artifactStoreContract + concurrent conflict; auth (cookie, API key, anonymous); core request forwarding; mock canReadDrafts; plugin endpoints; live checks on :3300 | user-approved-plan | accepted |
| D-0593 | Phasing: contract change, then source+auth+example, then artifacts, then plugin+admin | user-approved-plan | accepted |
| D-0594 | No draft mode: SourceContext is { request?: Request; locale; signal }, the actual request on every surface (public pages, preview, editor); no request = anonymous; Mode removed from sdk/host; the request only reaches the trusted source, never theme code | user | superseded by D-0595 |
| D-0595 | DataSource opts in with requireRequest: true; only then SourceContext has request: Request \| null (null = anonymous, typed through generics); without it the core never forwards the request and ctx has no request key; no draft mode, Mode removed | user | accepted |
| D-0596 | With a requireRequest source, templates whose blocks or root run a host-source query are uncacheable (cacheable false, proxy private/no-store), using the same static analysis as $query refs; http-only and static templates stay cacheable | user | accepted |
| D-0597 | Bindings rebuild the request from headers() with the origin root as URL (<proto>://<host>/): headers and origin only, not the path | user | accepted |
| D-0598 | Typing names: SourceContextBase { locale, signal }; SourceContext<R extends boolean = false>; CollectionDef<D, R = false> / GlobalDef<D, R = false> with property-syntax find/findByID/get (strict parameter checks); defineCollection<D, R>() / defineGlobal<D, R>(); defineDataSource infers R from requireRequest | agent-unreviewed | needs-review |
| D-0599 | createProxy config: source is optional (Partial<Pick<…, 'source'>>) so existing proxies keep compiling; uncacheable requireRequest templates reuse the existing 'cache-control: no-store' header (not 'private, no-store') | agent-unreviewed | needs-review |
| D-0600 | mockCms declares requireRequest only when canReadDrafts is given (requireRequest: !!canReadDrafts); collections typed with R = boolean | agent-unreviewed | needs-review |
| D-0601 | examples/app: auth.ts exports sessionOf(request) (parses the Cookie header, same HMAC check as getSession); puck-remote.config.ts passes canReadDrafts: (r) => !!sessionOf(r); editor resolveData action forwards remote.currentRequest() | agent-unreviewed | needs-review |
| D-0602 | Test seams: editorRequest() helper (authorization: editor) and dataDeps({ canReadDrafts }) in core/test/helpers.ts | agent-unreviewed | needs-review |
| D-0603 | Payload source: a non-draft query on a collection or global with versions.drafts only returns published content (find/findByID add _status equals published; a global whose _status is not published reads as null), whatever the app's access rules allow | user | accepted |
| D-0604 | createProxy option hostRoutes: string[] (path prefixes): on host origins served as-is (no rewrite under routes.admin, no redirect) with admin security headers and cache-control no-store; on other origins 404; examples/payload passes ['/admin', '/api'] | user | accepted |
| D-0605 | examples/theme/puck-remote.payload.cli.ts (url http://admin.localhost:3300/api/themes, Authorization 'users API-Key ${PAYLOAD_API_KEY}') and theme script release:payload = puck-remote push --live --config puck-remote.payload.cli.ts | user | accepted |
| D-0606 | examples/payload seed: admin@example.com / 'admin' and API key from PAYLOAD_API_KEY, 'dev-api-key' outside production (same default in the CLI config); demo-only in docs | user | accepted |
| D-0607 | Payload source details: globals read with depth 0; ids returned as Payload stores them (numbers on SQL); payloadSource exports toPayloadWhere, PayloadTypes, PayloadUser, PayloadCollectionOptions, PayloadGlobalOptions; validation error prefix '[puck-remote/payload]'; an or with a match-all clause matches all; failed Payload start retried on next query | agent-unreviewed | needs-review |
| D-0608 | graphql 16.14.2 added (Payload's required peer) to @puck-remote/payload devDependencies and examples/payload; examples/payload also depends on @payloadcms/next and @payloadcms/ui 3.90.2 | agent-unreviewed | needs-review |
| D-0609 | examples/payload layout: (app) and (puck) groups get their own root layout (no app/layout.tsx, Payload renders its own <html>); Payload template files copied from templates/blank v3.90.2 minus custom.scss (no sass dependency); src/payload.ts shares getPayload; schema: users (useAPIKey), authors (email not exposed), posts (drafts, read: user ? all : published, secretNotes not exposed), site global; site name 'Payload example' | agent-unreviewed | needs-review |
| D-0610 | examples/payload scripts generate:types and generate:importmap; seed via 'payload run src/seed.ts', reads examples/app/data/cms.json, does nothing when users exist; .gitignore examples/payload/data/*; src/payload-types.ts committed; root typecheck includes payload-example; .claude/launch.json entry payload-example | agent-unreviewed | needs-review |
| D-0611 | Proxy hostRoutes only apply when origins are configured (admin.length) | agent-unreviewed | needs-review |
| D-0612 | puckRemotePlugin option template?: (previewPath) => { name, params? } \| null; default: the path names the template ('/' → 'home', params { slug: name }), the examples' rule; null → not found | user | accepted |
| D-0613 | Plugin editor view mirrors examples/app's ClientEditor: header with theme name and role, Publish (save into the theme, conflict message), preview link for non-main themes, back to the themes list; built with Payload admin UI components | user | accepted |
| D-0614 | Payload store internals: collections defined in src/collections.ts (artifactCollections, THEME_LISTS, THEME_FILES; not a public entry), file data field skips Payload's text-length validation (validate: () => true) since the host size-limits files; store re-checks theme ids and paths like artifacts-fs; file upsert = find then update/create with a retry on a concurrent create | agent-unreviewed | needs-review |
| D-0615 | Plugin implementation: views registered as admin.components.views puckRemoteThemes (/puck-remote) and puckRemoteEditor (/puck-remote/editor), exact; options passed to views as serverProps.puckRemote; ThemesView wrapped in Payload's DefaultTemplate + Gutter; editor view full page; NavLink is a plain nav__link anchor labelled 'Themes'; core error classes loaded with dynamic import (keeps the engine out of the Payload config graph) | agent-unreviewed | needs-review |
| D-0616 | Plugin endpoint details: JSON bodies, 400 'invalid params' / 'invalid theme' / 'invalid name', 401 'unauthorized', 403 'forbidden', 404 'unknown operation', ThemeError status passed through; theme op names publish\|duplicate\|rename\|delete; rename name max 50 chars; request rebuilt from req.url origin root and req.headers; no-store responses; exported defaultTemplate | agent-unreviewed | needs-review |
| D-0617 | Plugin UI wording: Themes view headings 'Themes', role labels as examples/app ('Current theme', 'Theme library', 'Development themes'), 'No theme yet: push one with the puck-remote CLI.', not-allowed / not-found messages; actions Publish, Duplicate, Rename (prompt 'Theme name'), Delete (confirm 'Delete the theme "<name>" and its files?'), page reload after an action; editor header adds Preview and Themes links; editor frame rpc map { currentUser } | agent-unreviewed | needs-review |
| D-0618 | Packaging: subpaths ./plugin, ./admin, ./admin/client ('use client' banner, own entry imported by self-reference so the boundary survives bundling); CSS and self-imports external in tsdown; extra optional peers @payloadcms/next ^3.90.2 and @puckeditor/core ~0.23.0 (beyond the planned list), all admin peers optional via peerDependenciesMeta | agent-unreviewed | needs-review |
| D-0619 | examples/payload: src/origins.ts shares HOST_ORIGINS/EDITOR_ORIGIN/SITE_ORIGIN between the Payload config and puck-remote.config.ts (avoids an import cycle); @puck-remote/artifacts-fs dependency removed once the Payload store is used | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Draft reads (D-0594 → D-0595, D-0564, D-0565, D-0603).** Configured service user; `overrideAccess` in draft mode;
  ignore drafts; pass the real editor. The owner chose the request on every surface, with the
  plugin choosing user or anonymous preview. D-0594 supersedes D-0029 (its mock allowlists and
  clamps stay as implemented; only the host-only draft mode goes) and D-0202 (resolveBlockData no
  longer means "draft mode").
- **Theme list CAS (D-0576).** Global + transaction (READ COMMITTED lets two writers pass the
  check) vs append-only revisions with a unique `seq` (works on every Payload DB adapter).
- **Theme files (D-0577).** Payload upload collection with storage adapters (no generic API to read
  bytes, replacement not atomic) vs base64 rows in the database.
- **Plugin RPC (D-0584).** Payload server functions need the app's `(payload)/layout.tsx`; custom
  endpoints do not.
- **Request typing and cache (D-0595, D-0596).** The owner asked for an opt-in `requireRequest`
  flag that types `ctx.request` only when set, and for that flag to drive cacheability, after the
  plan's first version (request on every source, D-0594) raised the risk of a CDN caching a
  personalized page.
- **Published-only (D-0603).** Payload's `draft: false` returns never-published documents when the
  access rules allow them; the owner chose a source-side `_status` filter over relying on the app's
  access rules.
- **Proxy (D-0604).** `hostRoutes` in createProxy vs the example wrapping the proxy.
- **Packaging (D-0562).** One package vs `source-payload` / `artifacts-payload`: one Payload peer to
  track.

### Rationale
- Sources opt into the request so existing sources keep their cacheable pages; the type follows the
  flag so a source cannot read a request it never receives.
- Payload's own access control stays the authority over what a visitor or editor sees; the core
  still enforces the exposed-field policy around it.
- Storing themes in Payload's database makes a Payload app multi-instance with no extra service.
- One package keeps one Payload peer range to track.

### Trade-offs Accepted
- Pages running a `requireRequest` source's queries are never cacheable.
- Theme files as base64 rows: +33% size, 16 MB per file on MongoDB; theme list polled (2 s).
- The Payload Local API cannot cancel a query past the page deadline.
- The plugin's editor view needs `payload generate:importmap` and the app's editor-origin page.

## Implementation
### Public API / config changes
- sdk/host: `SourceContext<R>` (request only with `requireRequest`), `SourceContextBase`,
  `DataSource.requireRequest`, `CollectionDef<D, R>`, `GlobalDef<D, R>`, `defineCollection<D, R>`,
  `defineGlobal<D, R>`; `Mode` removed.
- core: `TemplateOptions.request`, `resolveBlockData(…, { request })`, cacheability with
  `requireRequest` (`templateCacheability({ artifacts, source? })`).
- next: `remote.currentRequest()`, `loadTemplate` forwards the request, `createProxy` reads
  `source` and takes `hostRoutes`.
- source-mock: `canReadDrafts`.
- New `@puck-remote/payload`: `/source` payloadSource, `/artifacts` payloadArtifactStore, `/auth`
  payloadAuthorize + payloadUser, `/plugin` puckRemotePlugin (core, editorUrl, previewAs, artifacts,
  access, template) + defaultTemplate, `/admin` views, `/admin/client`.

### Docs pages touched
core/adapters/{payload (new), data-source, artifact-store, index}, core/{index, entry-points, meta},
sdk/host-contracts, (framework)/guides/{payload (rewrite), other-frameworks}, (framework)/concepts/
{adapters, declarative-data, editor, trust-model}, (framework)/{installation, next-js/api},
internal/architecture/{host-source, query-resolver, public-request, editor-lifecycle, threat-model},
internal/quality/{testing, known-gaps}, internal/contributing/docs. CLAUDE.md command table.

Migration: custom data sources that read `ctx.mode` must declare `requireRequest: true` and decide
from `ctx.request`; apps forward `request` to `resolveBlockData` (examples/app does).

## Investigation Notes
- Payload 3.90.2 peers: next `>=16.3.3 <17` (16.4 fine), graphql ^16. Runs on SQLite under vitest.
- Payload's `draft: false` still returns never-published docs the user may read (main collection,
  `_status: 'draft'`): led to D-0603.
- A global core registry for the plugin (owner's first pick) failed on evaluation order (Payload's
  routes never import the app's puck-remote module); back to the lazy getter.

## Challenges & Solutions
- The staged admin `(admin)` move on feat/artifact-api was not found in any commit; the owner chose
  to proceed without it (empty folders left untouched).
- Payload's `defaultMaxTextLength` (40 000) rejected base64 bundles: the store's data field skips
  that validation (host size limits apply).
- The proxy rewrote Payload's `/admin` and `/api` under routes.admin: `hostRoutes` (D-0604).
- Fixture passwords under Payload's minimum length; stale module-not-found until `pnpm install`.

## Impact Assessment
- Security: the request never reaches theme code; per-visitor pages are never cacheable; Payload
  routes only on host origins; store collections closed to API access.
- Performance: one `payload.auth` per request; Payload-backed pages are `no-store`.

## Quality Assurance
- build, test (core 153 + 1 skipped, cli 20, editor 21, next 26, payload 29), typecheck (incl.
  payload-example), lint:pkg, docs:build, check-docs-adr pass.
- Live on :3300: Payload admin login under the admin CSP; `/admin` and `/api` 404 on the site;
  push with the API key (wrong key: 401); site from Payload without the draft (`no-store`); themes
  view, Duplicate; editor in Payload admin shows the draft with previewAs 'user', hides it with
  'anonymous'; Publish updates the site title.
- Live on :3100 (with mock-api): site hides the draft; the signed-in admin's editor shows it.
- Observed, not investigated: with mock-api down, examples/app pages took minutes and logged an
  uncaught AggregateError from the events adapter's failed connection.

## Outcome & Lessons
Payload works as the backend end to end. Lesson: Payload's draft and access semantics differ from
'published only' and needed an explicit rule.

## Tags
payload data-source artifacts auth editor adapters
