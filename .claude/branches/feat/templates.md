---
title: "Templates instead of pages; app-owned root props"
description: "The core knows Shopify-like templates (named Puck documents with any root props) instead of pages; apps pick templates per route, pass params, own root fields and metadata."
---

# Branch ADR: feat/templates

## Meta
- **Branch**: feat/templates
- **Type**: feat
- **Created**: 2026-10-09
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved in session, 2026-10-09)
- **PR**: (not yet created)

## Problem Statement
### Context
The core owned a "page" notion: `pages/<slug>.json` in artifacts, URL path = slug (normalizeSlug,
catch-all route, proxy cacheability by path), the theme's defineRoot owned every root field, and
metadata flowed from the sandbox (ctx.head) to Next through pageMetadata / generateMetadata. The
owner asked to replace pages with Shopify-like templates: plain named documents with any props,
no metadata abstraction, a function to load a template, and app-owned root props (with types for
the theme root).

### Goals
- Core API speaks templates (prepare/read/write/editorPayload by name) and params.
- Apps decide routing and metadata; the example keeps path → same-name template.
- App root fields in the config, merged before the theme's, typed for themes via Register.

### Non-Goals
- No legacy reader for `pages/` artifacts; no sdkMajor bump (D-0392).
- No template list/delete API; no validation of root prop values on write.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0369 | Theme root gets the app's root prop types through Register augmentation (Register.rootProps) | user | accepted |
| D-0370 | ctx.head (title/meta), pageMetadata and generateMetadata removed; the app builds metadata from template root props; ctx.assets stays | user | accepted |
| D-0371 | The app picks the template per route; the example app keeps the catch-all mapping path -> template name | user | accepted |
| D-0372 | App root fields are declared in PuckRemoteConfig | user | accepted |
| D-0373 | Root field name collision: the app's field wins, a warning is logged when the artifact loads | user | accepted |
| D-0374 | Page-specific data is passed as params to loadTemplate, readable by data refs and ctx | user | accepted |
| D-0375 | Work on feat/templates branched from feat/split-editor HEAD, carrying its uncommitted changes untouched | user | accepted |
| D-0376 | Template names use the former slug format ([a-z0-9][a-z0-9-]{0,63}, up to 5 / segments) | user-approved-plan | accepted |
| D-0377 | No legacy reader: artifacts with pages/ are refused; the example's artifacts are deleted and republished | user-approved-plan | accepted |
| D-0378 | params: Record<string,string> (<=32 keys, <=1 KB values); refs { $params: key } (missing -> null) and { $template: 'name'\|'locale' } replace $page; ctx.template { name } and ctx.params replace ctx.page | user-approved-plan | accepted |
| D-0379 | Config root?: { fields, defaultProps? }; merge app first then unshadowed theme fields; merged root sent in EditorPayload.root; warning text '[puck-remote] root field "<name>" is defined by the app and the theme; the app's is used'; no value validation on write | user-approved-plan | accepted |
| D-0380 | defineRoot render props = PropsOf<theme fields> & Register.rootProps; SDK exports RootPropsOf<typeof fields>; example theme declares rootProps inline | user-approved-plan | accepted |
| D-0381 | Example app: catch-all loadTemplate(slug,{params:{slug}}), own generateMetadata from root title/description; config root fields title/description; theme root keeps only theme; admin editor maps path -> name | user-approved-plan | accepted |
| D-0382 | Editor protocol init carries template, params, root (merged fields/defaults); PROTOCOL_VERSION bumped by 1; resolveData passes payload params | user-approved-plan | accepted |
| D-0383 | Docs: guides/publishing becomes 'Templates and publishing'; Root props section in configuration; SDK/CLI/core/internal pages updated; 'page' kept for app web pages | user-approved-plan | accepted |
| D-0384 | Tests: existing tests ported; new tests for root merge/warning, $params/$template/ctx.params, pages/ refusal, loadTemplate 404, proxy without template option; type test for Register.rootProps | user-approved-plan | accepted |
| D-0385 | Root fields = theme fields + app fields merged; themes cannot override app fields | user | accepted |
| D-0386 | Artifact layout templates/<name>.json listed and verified in manifest.files; theme source dir templates/ | user-approved-plan | accepted |
| D-0387 | Core API: prepareTemplate(name,{params,query,locale}), readTemplate, writeTemplate, resolveBlockData(name,block,props,{params}), editorPayload(name,{artifact,params}); PreparedTemplate, TemplateData, TemplateError, MAX_TEMPLATE_BYTES, templateCacheability, PuckRemoteTemplate; normalizeSlug kept | user-approved-plan | accepted |
| D-0388 | Next: loadTemplate(name,{params,searchParams,locale}) (404 on host origins and unknown templates, CSP nonce), loadEditor(name,{params}), generateMetadata removed, PageProps renamed RouteProps | user-approved-plan | accepted |
| D-0389 | Proxy cacheability via createProxy option template(pathname) -> { name } \| null; none set without it; headers x-template-cacheable | user-approved-plan | accepted |
| D-0390 | CLI: build copies templates/*.json; pull writes <cwd>/templates; validate checks $params/$template; build does not check app root fields | user-approved-plan | accepted |
| D-0391 | normalizeSlug leaves @puck-remote/core and /next; it becomes an example-app function (path -> template name), used by its pages, actions and proxy | user | accepted |
| D-0392 | Manifest sdkMajor stays 3 despite the ctx input change (old artifacts without pages/ fail per block at render) | user | accepted |
| D-0393 | New public type names: TemplateOptions (core), LoadTemplateOptions (next), ProxyOptions (next/proxy); createProxy takes options as a second argument | agent-unreviewed | needs-review |
| D-0394 | PuckEditorFrame resolveData receives a third argument template: { name, params } from the payload; buildEditorConfig takes a 5th rootOverride argument (RootOverride); with app fields but no theme root, the root has fields and Puck's default render | agent-unreviewed | needs-review |
| D-0395 | RootDefinition became an explicit interface (fields, defaultProps, data, render) instead of an Omit alias, so render props infer with Register.rootProps | agent-unreviewed | needs-review |
| D-0396 | The shadowed-root-field warning fires on first use of an artifact (prepareTemplate / editorPayload), not on the loader's load event | agent-unreviewed | needs-review |
| D-0397 | Wording: TemplateError, ConfigError (root.fields), manifest pages/ refusal, params and CLI template messages; 'too many asset effects'; pull() returns { id, templates }; validatePage renamed validateTemplate | agent-unreviewed | needs-review |
| D-0398 | Example app: src/template-name.ts holds normalizeSlug; admin editor route stays non-catch-all (edits home); metadata title format '<title> · <site>' and defaults moved from the theme; params { slug: name } | agent-unreviewed | needs-review |
| D-0399 | Docs structure: 'Templates' section in core overview, 'Root fields' in configuration, 'Root props from the app' in SDK blocks; Next setup shows template-name.ts | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Root fields: app only; theme + app merged (chosen, app wins, D-0385/D-0373); app-owned with theme requirements.
- Root types: Register augmentation (chosen, D-0369); defineRoot generic; both.
- Metadata: remove ctx.head and generateMetadata (chosen, D-0370); keep ctx.head as optional data.
- Routing: app picks templates (chosen, D-0371); plus a built-in path helper. normalizeSlug finally left the packages entirely (D-0391).
- App fields location: PuckRemoteConfig (chosen, D-0372) vs PuckEditorFrame prop.
- Page-specific data: params on loadTemplate (chosen, D-0374) vs later.
- Proxy mapping helper: re-export, built-in mapper, relax rule; owner chose an app-local function (D-0391).

### Rationale
Templates make the core routing-agnostic (Shopify model): one template can serve many URLs with
params. Root fields in the config give the server defaults and the editor the same source. App
fields win so a theme can never hijack the app's SEO or other host-owned props.

### Trade-offs Accepted
- Old artifacts must be rebuilt (pages/ refused); an old artifact without pages/ would fail per block (sdkMajor kept 3).
- Cache headers need the app to repeat its path → template mapping in the proxy.
- Apps write their own generateMetadata.

## Implementation
### Public API / config changes
- core: prepareTemplate, readTemplate, writeTemplate, editorPayload(name, { params }), resolveBlockData(name, block, props, { params }); TemplateError, MAX_TEMPLATE_BYTES, TemplateData, TemplateOptions, PreparedTemplate; edge templateCacheability; react PuckRemoteTemplate; normalizeSlug and pageMetadata removed; config `root`.
- sdk: ctx.template, ctx.params (ctx.page, ctx.head removed); refs `$template`, `$params` (`$page` removed); TEMPLATE_REF_KEYS; Register.rootProps, RegisteredRootProps, RootPropsOf.
- next: loadTemplate, loadEditor(name, opts), RouteProps, LoadTemplateOptions; generateMetadata removed; createProxy(config, { template }); header x-template-cacheable.
- editor: payload template/params/root, PROTOCOL_VERSION 3, resolveData third argument.
- cli: templates/ dir, pull returns templates.

### Docs pages touched
core/index, core/entry-points; (framework)/configuration, installation, http-api, index, next-js/{index,api}, guides/{publishing,other-frameworks,theme-development,editor-app,payload}, concepts/{adapters,artifacts,declarative-data,editor,blocks-and-isolate}; sdk/{blocks,context,data,query-spec,manifest}; cli/{commands,build-output}; internal/architecture/{public-request,editor-lifecycle,editor-protocol,build-pipeline,missing-blocks,threat-model,query-resolver,islands}; internal/quality/{testing,known-gaps,performance}; internal/contributing/docs.

[Key changes, files, testing, migration plan]

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
- D-0388 was recorded superseding D-0213, already superseded by D-0239: the chain broke (`pnpm adr check` failed). At the owner's request the agent repaired the index directly (D-0213 → D-0239 restored; D-0388 now supersedes D-0239) and re-synced the ADR tables.
- The uncommitted split-editor changes listed at session start were no longer in the working tree when the branch was created (no stash, nothing discarded by the agent).
- Root render props were `any` through the Omit alias; RootDefinition became an interface (D-0395).
- The no-dev-code rule forbade apps importing core/edge: normalizeSlug moved to the example app (D-0391).

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
- pnpm typecheck, pnpm test (core 103 + 1 skipped, cli, editor, next 15), pnpm lint:pkg, pnpm docs:build: pass.
- New tests: core/test/templates.test.ts (merge, warning, params, refs, pages/ refusal), routes.test.ts (merged root in payload, params), next/test/load-template.test.ts, proxy cache headers, theme type-tests (Register.rootProps).
- Manual: site title/description from app metadata, x-template-cacheable on / and no-store on /search, 404 for unknown; admin editor shows Page title + Meta description then theme; publish wrote templates/home.json in a new artifact (then rolled back).

## Outcome & Lessons
[Final results and lessons learned]

## Tags
templates root core next sdk
