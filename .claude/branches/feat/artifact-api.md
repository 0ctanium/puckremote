---
title: "Artifact publication API, Shopify-like themes and puck-remote dev"
description: "The CLI publishes through an HTTP API the app mounts with its own authorize; the single pointer becomes Shopify-like themes (main, unpublished, one development theme per device, or a single theme); puck-remote dev pushes to the device theme, previewed with signed links."
---

# Branch ADR: feat/artifact-api

## Meta
- **Branch**: feat/artifact-api
- **Type**: feat
- **Created**: 2026-10-10
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved in session, 2026-10-10)
- **PR**: (not yet created)

## Problem Statement
### Context
The CLI wrote straight into an `fsArtifactStore` directory, so publishing needed filesystem access
to the host and only worked with that adapter (known gap: "artifacts are published by writing to
the store directly"). The owner wants Shopify-like local theme development: the CLI talks to an API
any host can mount over any store, with app-owned auth, and a `dev` command. One pointer (D-0009)
makes parallel `dev` sessions collide.

### Goals
- HTTP artifacts API in core + Next handler, `authorize` required, uploads fully verified.
- Named heads in the store contract; `live` serves the site; per-developer heads.
- Preview of non-live heads in the editor and on public pages (signed cookie).
- CLI: API-only publish/pull/activate/heads, `package` (local .tar.gz), `dev` watcher.

### Second iteration: themes (2026-10-10)
The owner asked to replace heads with Shopify's model (OnlineStoreTheme): several themes with a
name, a role and dates; dev themes per device named after it, remembered by the CLI, expiring after
7 days; and a trivial single-theme setup. Heads were never committed, so themes replace them on this
branch (D-0444–D-0469, superseding the head decisions).

### Third iteration: CLI config and live reload (2026-10-11)
The owner asked to drop the mandatory PUCK_REMOTE_TOKEN for a CLI config file (`puck-remote.cli.ts`:
url, headers, fetch) so any auth works, and for Vite-like live reload of preview pages driven by a
local SSE server in `puck-remote dev` (D-0482–D-0498).

### Fourth iteration: files per theme (2026-10-11)
The owner asked for Shopify's storage model: one directory per theme holding only its current
files, the theme's `artifact` field renamed `hash` (its version, sha256 of manifest.json), and
pushes (above all `dev`) sending only the files that changed, so heavy assets are not re-uploaded.
After a detailed comparison with Shopify, the owner chose in-place writes without load-time
verification (D-0506–D-0527; implementation choices made without approval: D-0528–D-0546).

### Fifth iteration: route paths (2026-10-11)
The owner asked for app-like paths: the artifacts API at `/api/themes` (a route of its own, no
catch-all at `/api`, no `themes` segment inside the handler), the preview route at
`/theme/preview`, the editor frame page at `/theme/editor`, and the template of the example's
admin editor in `?previewPath=` like Shopify's theme editor (D-0547–D-0557; unreviewed: D-0558,
D-0559).

### Non-Goals
- Live reload, per-file sync, signed manifests, per-theme data/secrets, theme limit, artifact GC.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0403 | Scope: publication API, named heads and puck-remote dev in one branch | user | accepted |
| D-0404 | Non-live heads previewable in the admin editor and on public pages (signed preview cookie) | user | accepted |
| D-0405 | publish talks to the API only; new 'package' command builds the artifact into one compressed file | user | accepted |
| D-0406 | Work on feat/artifact-api branched from feat/templates HEAD | user | accepted |
| D-0407 | Named heads replace the single pointer; 'live' serves the site, one head per developer | user-approved-plan | superseded by D-0444 |
| D-0408 | ArtifactStore: readHead(name), writeHead(name, id, { expect? }), deleteHead(name), listHeads(), watch?(onChange(head)); readPointer/writePointer removed, no alias | user-approved-plan | superseded by D-0451 |
| D-0409 | Live head named 'live' (LIVE_HEAD from @puck-remote/sdk/host); head names [a-z0-9][a-z0-9-]{0,63} checked by core and artifacts-fs | user-approved-plan | superseded by D-0450 |
| D-0410 | writeHead expect = compare-and-swap, HeadConflictError on mismatch; artifacts-fs uses an O_EXCL lock heads/.lock (stale after 10 s); example publish action uses it | user-approved-plan | superseded by D-0451 |
| D-0411 | artifacts-fs layout <dir>/heads/<name>.json (temp + rename); current.json dropped without migration; watch reports the head name | user-approved-plan | superseded by D-0454 |
| D-0412 | Core loads, polls and watches only the live head for public traffic | user-approved-plan | superseded by D-0457 |
| D-0413 | Non-live artifacts render through an LRU of extra runtimes: config previewRuntimes { max: 3, idleMs: 600000 }, validated like the live artifact | user-approved-plan | accepted |
| D-0414 | prepareTemplate, readTemplate and editorPayload accept { head }; unknown head behaves like an unknown template | user-approved-plan | superseded by D-0456 |
| D-0415 | Config preview { secret, ttlSeconds = 3600 } (disabled when absent) and origins.site (canonical public origin for preview links) | user-approved-plan | accepted |
| D-0416 | Preview token base64url(JSON {h, exp}).base64url(HMAC-SHA256); core createPreviewUrl(head) and previewHead(cookie) | user-approved-plan | superseded by D-0461 |
| D-0417 | Preview route routes.preview (default /puck-remote/preview) sets cookie puck_remote_preview (HttpOnly, SameSite=Lax, Path=/, Secure in prod, Max-Age ttl) and redirects to /; ?exit clears it; Next createPreviewHandler() | user-approved-plan | superseded by D-0548 |
| D-0418 | loadTemplate renders the head of a valid preview cookie with Cache-Control private, no-store; proxy marks cookie requests not cacheable; no injected preview bar | user-approved-plan | superseded by D-0480 |
| D-0419 | Admin editor opens a head with loadEditor(name, { head }); the example reads ?head= and publishes to that head | user-approved-plan | superseded by D-0466 |
| D-0420 | Core handleArtifactsApi(request, { authorize }); Next createArtifactsHandler({ authorize }) at routes.api (default /puck-remote/api) | user-approved-plan | superseded by D-0547 |
| D-0421 | authorize(req, action) required, fail closed; ApiAction { kind: upload\|read\|list\|setHead\|deleteHead, head? }; false gives 401 { error: 'unauthorized' } | user-approved-plan | superseded by D-0471 |
| D-0422 | API route answers on host origins only (not rewritten under admin), 404 elsewhere, Cache-Control no-store, no CORS | user-approved-plan | accepted |
| D-0423 | Endpoints: POST /artifacts (package, 201 {id}), GET /artifacts, GET /artifacts/<id>/<path>, GET /heads, PUT /heads/<name> {id, expect?} -> {id, previewUrl?} (409), DELETE /heads/<name> (live refused 400) | user-approved-plan | superseded by D-0462 |
| D-0424 | Uploads verified before writeArtifact: manifest schema, every sha256, file set exactly manifest.files + manifest.json, safe paths (shared verifyArtifact) | user-approved-plan | superseded by D-0514 |
| D-0425 | API limits config api { maxPackageBytes: 50 MB, maxUnpackedBytes: 200 MB, maxFiles: 5000 }, 413 over; errors { error } with 400/401/404/409/413 | user-approved-plan | accepted |
| D-0426 | Package format .tar.gz (ustar, dist/ at the root) via nanotar 0.3.0 in core and cli | user-approved-plan | superseded by D-0434 |
| D-0427 | CLI commands: build, package [--file], publish [--file] [--head], pull [--head\|--artifact], activate <id> [--head], heads, heads rm <name>, dev [--head] | user-approved-plan | superseded by D-0448 |
| D-0428 | CLI connection --url / PUCK_REMOTE_URL, token PUCK_REMOTE_TOKEN env only (Bearer); --artifacts and the artifacts-fs dependency removed; programmatic { url, token, fetch? } | user-approved-plan | superseded by D-0484 |
| D-0429 | dev: build, upload, move head, print preview URL; fs.watch recursive (ignore dist, node_modules, dot dirs), 300 ms debounce; repo templates overwrite the head; no live reload; default head dev-<user>; head kept on exit | user-approved-plan | superseded by D-0465 |
| D-0430 | Example app: API authorize = timingSafeEqual Bearer vs PUCK_REMOTE_DEPLOY_TOKEN, preview secret PUCK_REMOTE_PREVIEW_SECRET (dev fallbacks, production fails closed), origins.site, dashboard heads with editor/preview links, theme scripts use --url, dev script | user-approved-plan | superseded by D-0466 |
| D-0431 | Docs: new guides/theme-dev, artifacts-api, internal/architecture/heads-and-preview; adapter, CLI, Next, config, env, concepts, publishing, known-gaps, testing pages updated | user-approved-plan | accepted |
| D-0432 | Tests: fs heads, artifacts API, preview tokens and runtime LRU, proxy api/preview, CLI against an in-process http server; browser check with two dev heads | user-approved-plan | accepted |
| D-0433 | PreparedTemplate.preview?: { head } set only when a preview cookie selected the head (PreparedTemplate.head already holds head effects) | user | superseded by D-0456 |
| D-0434 | Packages are written and read with tar 7.5.22 (isaacs) instead of nanotar, whose writer truncates paths over 100 bytes | user | accepted |
| D-0435 | resolveBlockData also accepts { head } (the editor on a dev head resolves data with that head's manifest) | agent-unreviewed | superseded by D-0456 |
| D-0436 | Exports: sdk/host WriteHeadOptions, HEAD_NAME, isHeadName, ApiAction, AuthorizeApi; core re-exports HeadConflictError, isHeadName, LIVE_HEAD, ApiAction, AuthorizeApi, PreviewConfig, PREVIEW_COOKIE (also from /edge) so next and the example need no sdk dependency | agent-unreviewed | needs-review |
| D-0437 | Wording: API errors (unauthorized, not found, method not allowed, upload: hash mismatch…, package is not a gzip-compressed tar, body larger than N bytes, the live head cannot be deleted…), preview 'Invalid or expired preview link', CLI messages ('an API token is required (PUCK_REMOTE_TOKEN)', 'nothing published on head …') | agent-unreviewed | needs-review |
| D-0438 | CLI-over-HTTP tests live in packages/core/test/cli-api.test.ts (core already dev-depends on the CLI; the reverse would be a cycle); fixtures in packages/core/test/.fixtures (gitignored) | agent-unreviewed | needs-review |
| D-0439 | Config check: empty preview.secret is a ConfigError; without origins the API route answers 404 everywhere; preview set on PreparedTemplate whenever opts.head is passed (live included) | agent-unreviewed | needs-review |
| D-0440 | Example: production without PUCK_REMOTE_PREVIEW_SECRET disables preview (no throw); origins.site is http://localhost:PORT without an env override; editor status shows the head when not live; release script = publish (publish builds) | agent-unreviewed | needs-review |
| D-0441 | editorPayload sends origins { host, editor } only: the editor protocol's strict origins schema rejected the new site key (frame stuck on 'Waiting for the admin page') | agent-unreviewed | needs-review |
| D-0442 | artifacts-fs watch: when heads/ appears, report the heads already written before the watcher attached | agent-unreviewed | superseded by D-0454 |
| D-0443 | Docs: quick start publishes after starting the host (the API needs it); installation shows the API route with a DEPLOY_TOKEN authorize; new guide titled 'Local theme development' | agent-unreviewed | needs-review |
| D-0444 | Themes like Shopify replace heads: a site has several themes with id, name, role (main = live, unpublished, development) and dates | user | accepted |
| D-0445 | Single theme by default: config themes.multiple = false; apps opt in to several themes | user | accepted |
| D-0446 | Dev theme per device, Shopify-style name, id remembered by the CLI in a user-level file keyed by API URL | user | accepted |
| D-0447 | Development themes expire after 7 days of inactivity, cleaned lazily by the API plus core.themes.prune() | user | accepted |
| D-0448 | CLI mirrors shopify theme: push, publish, pull, dev, list, rename, delete, duplicate, share, package; activate and heads removed | user | accepted |
| D-0449 | Theme work continues on feat/artifact-api (heads uncommitted) superseding the head decisions | user-approved-plan | accepted |
| D-0450 | Theme = { id, name, role: main\|unpublished\|development, artifact, createdAt, updatedAt } (ISO dates); only these three roles | user-approved-plan | superseded by D-0511 |
| D-0451 | Core owns theme logic; ArtifactStore keeps the list: readThemes() -> { version, themes }, writeThemes(themes, { expect: version }) (CAS, ThemeConflictError THEME_CONFLICT), watch?(onChange) | user-approved-plan | superseded by D-0512 |
| D-0452 | Theme ids generated by the core (12 random lowercase hex); names trimmed, 1-50 characters, no control characters, not unique | user-approved-plan | accepted |
| D-0453 | Core checks on every write: at most one main theme; every theme artifact exists | user-approved-plan | accepted |
| D-0454 | artifacts-fs: <dir>/themes.json { themes }, version = sha256 of the file, temp + rename under <dir>/.themes.lock (stale after 10 s); heads/ dropped without migration | user-approved-plan | superseded by D-0513 |
| D-0455 | core.themes: list, get, main, create, update(id, { name?, artifact? }, { expect? }), publish (previous main -> unpublished), delete (main refused), duplicate ('Copy of <name>', unpublished), prune; changes to main reload the live runtime | user-approved-plan | superseded by D-0516 |
| D-0456 | { theme } (theme id) replaces { head } on prepareTemplate, readTemplate, editorPayload, resolveBlockData; unknown theme like an unknown template; PreparedTemplate.preview = { theme: { id, name, role } } | user-approved-plan | accepted |
| D-0457 | The loader serves the main theme's artifact (readThemes polling or store watch) | user-approved-plan | accepted |
| D-0458 | Config themes { multiple = false, devExpiryDays = 7 } | user-approved-plan | accepted |
| D-0459 | Single mode: only a main theme; create allowed only with no theme (role main); other roles, duplicate and publish refused (409 'this site has a single theme (themes.multiple is false)'); push defaults to main; dev refused; no preview links | user-approved-plan | accepted |
| D-0460 | prune() deletes development themes whose updatedAt is older than devExpiryDays; the API runs it before GET /themes and POST /themes; artifacts are kept | user-approved-plan | accepted |
| D-0461 | Preview token { t: themeId, exp }; no preview link for the main theme | user-approved-plan | accepted |
| D-0462 | API theme endpoints: GET/POST /themes, GET/PATCH/DELETE /themes/<id>, POST /themes/<id>/publish, POST /themes/<id>/duplicate; heads endpoints removed; main delete -> 400 | user-approved-plan | superseded by D-0520 |
| D-0463 | ApiAction kinds upload\|read\|list\|createTheme\|updateTheme\|publishTheme\|deleteTheme with theme { id?, name, role } | user-approved-plan | superseded by D-0537 |
| D-0464 | push [-t] [--live] [--unpublished] [--name] [--file] [--artifact]; publish -t; pull [-t] [--live]; dev [-t]; list [--role]; rename; delete -t \| --development; duplicate; share; --theme resolves an exact id, then a unique name | user-approved-plan | superseded by D-0523 |
| D-0465 | Dev theme name 'Development (<6 hex>-<hostname>)' truncated to 50; id in ${XDG_CONFIG_HOME:-~/.config}/puck-remote/dev-themes.json keyed by normalized API URL; a 404 creates a new one | user-approved-plan | accepted |
| D-0466 | Example: themes.multiple true; dashboard theme library (Customize, Preview, Publish, Delete server actions); editor ?theme= saves with core.themes.update expect; scripts release=push --live, dev, pull, share | user-approved-plan | superseded by D-0525 |
| D-0467 | Docs: themes replace heads; new concepts/themes and internal/architecture/themes-and-preview; adapter, config, HTTP API, CLI, Next, guides, quick start, gaps, testing updated | user-approved-plan | accepted |
| D-0468 | Tests: contract CAS, fs themes.json, themes.test.ts, API theme endpoints and single mode, preview tokens, CLI name/resolution/dev file, CLI over HTTP with two devices and expiry; browser library checks | user-approved-plan | accepted |
| D-0469 | Out of scope: theme limit, artifact garbage collection, rename UI, theme settings or locking | user-approved-plan | accepted |
| D-0470 | GET /themes also returns multiple (themes.multiple) so the CLI knows whether push without flags targets main | agent-unreviewed | needs-review |
| D-0471 | POST /themes and duplicate read their JSON body (<= 4 KB) before authorize so the action carries name and role; upload bodies are still never read before authorize | agent-unreviewed | needs-review |
| D-0472 | Action mapping: duplicate -> createTheme { name, role: unpublished }; GET /themes/<id> -> read with theme; unknown theme -> authorize with theme undefined, then 404 | agent-unreviewed | needs-review |
| D-0473 | Theme writes retry up to 5 times on THEME_CONFLICT (re-read and re-apply); an expect mismatch is never retried | agent-unreviewed | needs-review |
| D-0474 | publish accepts any role, development included (Shopify cannot publish development themes) | agent-unreviewed | needs-review |
| D-0475 | Theme error wording ('theme name must be 1 to 50 characters', 'a main theme already exists: create an unpublished theme and publish it', 'theme <id> changed (expected …, found …)', 'the main theme cannot be deleted', CLI 'several themes are named …', 'no theme …', 'nothing published yet (no main theme)') | agent-unreviewed | needs-review |
| D-0476 | createArtifactsHandler returns { GET, POST, PATCH, DELETE } (PUT dropped with the heads endpoints) | agent-unreviewed | needs-review |
| D-0477 | Exports: core isThemeId, MAX_THEME_NAME, ThemeError, ThemeOps, THEME_ROLES, ThemeConflictError, Theme, ThemeRole; edge-safe main-theme.ts; CLI generateThemeName, resolveTheme, devThemesFile, getDevTheme, setDevTheme, apiKey, deleteDevTheme | agent-unreviewed | needs-review |
| D-0478 | CLI details: -t short flag; list prints 'id role updated name'; pull has no --live (main is its default); dev rejects when its first push fails for a non-build reason; dev options devThemesFile and hostname | agent-unreviewed | needs-review |
| D-0479 | Example: dashboard sections 'Current theme', 'Theme library', 'Development themes'; editor status shows theme name and role; theme-actions.ts with revalidatePath; theme 'publish' script removed (publish now means make main) | agent-unreviewed | needs-review |
| D-0480 | loadTemplate renders the theme of a valid preview cookie (Cache-Control private, no-store); the proxy marks cookie requests not cacheable (D-0418 restated for themes) | user-approved-plan | accepted |
| D-0481 | dev keeps the D-0429 behavior for themes: whole package uploaded on each change, 300 ms debounce, dist/node_modules/dot dirs ignored, no live reload, a failed build keeps the theme | user-approved-plan | superseded by D-0546 |
| D-0482 | CLI config file puck-remote.cli.ts in the theme repo: export default defineCliConfig({ url, headers?, fetch? }) | user | accepted |
| D-0483 | CLI requests are shaped by config headers (object or async function) and fetch(request) for full control | user | accepted |
| D-0484 | PUCK_REMOTE_TOKEN removed; the CLI sends no auth of its own | user | accepted |
| D-0485 | Live reload over SSE: dev runs a loopback SSE server, the preview link carries its URL, preview pages get an EventSource script, CSP allows that origin for previews only | user | accepted |
| D-0486 | Config lookup in --cwd: puck-remote.cli.ts, .mts, .js, .mjs (first found); --config overrides; loaded with import() (Node 26 strips TypeScript) | user-approved-plan | accepted |
| D-0487 | @puck-remote/cli/config exports defineCliConfig and CliConfig { url?, headers?, fetch?, dev?: { reload?: false \| { port? } } }; headers added to every request, then fetch (default global) | user-approved-plan | accepted |
| D-0488 | URL precedence --url > PUCK_REMOTE_URL > config.url; no URL -> 'the artifacts API URL is required (--url, PUCK_REMOTE_URL or url in puck-remote.cli.ts)'; no config file is fine | user-approved-plan | accepted |
| D-0489 | Programmatic ApiTarget { url, headers?, fetch? } (token removed); loadCliConfig({ cwd, file? }) | user-approved-plan | accepted |
| D-0490 | Example theme puck-remote.cli.ts: url admin.localhost:3100 API, Bearer PUCK_REMOTE_DEPLOY_TOKEN with dev-token fallback; scripts drop --url; quick start drops PUCK_REMOTE_TOKEN | user-approved-plan | accepted |
| D-0491 | dev SSE server on 127.0.0.1, port dev.reload.port default 9293 (next free up to +10); dev.reload false or --no-reload disables | user-approved-plan | accepted |
| D-0492 | SSE: GET /events text/event-stream, CORS *, ping comment every 15 s, event reload { theme, artifact } after each push; other paths 404 | user-approved-plan | superseded by D-0536 |
| D-0493 | Preview link gets &reload=http://127.0.0.1:<port>; preview route keeps loopback http URLs with a port in cookie puck_remote_reload (same attributes/lifetime), ignores others; ?exit clears both | user-approved-plan | accepted |
| D-0494 | loadTemplate passes the reload cookie only during a preview; PreparedTemplate.preview.reload; TemplateOptions.reload (ignored without theme); PuckRemoteTemplate renders a nonce'd EventSource reload script | user-approved-plan | accepted |
| D-0495 | createProxy adds the reload origin to site connect-src only with a preview cookie and a valid reload cookie; securityHeaders extraConnectSrc option | user-approved-plan | accepted |
| D-0496 | Not in scope: editor frame reload on push, CSS hot swap, a local proxy | user-approved-plan | accepted |
| D-0497 | Docs: new cli/configuration; commands, programmatic API, CLI index, theme-dev, http-api, environment, quick start, installation, next-js api, core index, internal themes-and-preview, testing updated | user-approved-plan | accepted |
| D-0498 | Tests: CLI config lookup/headers/fetch/URL; custom-header auth and SSE over HTTP; preview reload cookie and script; proxy CSP; loadTemplate reload; browser auto-reload | user-approved-plan | accepted |
| D-0499 | Reload cookie value is URI-encoded; a preview link without a valid reload clears it; malformed values are ignored (safe decode in Next and the proxy) | agent-unreviewed | needs-review |
| D-0500 | reloadOrigin also refuses paths, queries, credentials and URLs over 64 characters | agent-unreviewed | needs-review |
| D-0501 | Config loading: only API commands load it (lazily); errors 'no config file at <path>' and '<file> must export a config object (export default defineCliConfig({ … }))'; CONFIG_FILES and loadCliConfig exported from the CLI root | agent-unreviewed | needs-review |
| D-0502 | SSE details: ': connected' comment on connect, server unref'd; startReloadServer and DEFAULT_RELOAD_PORT exported; dev() returns reloadUrl and close() becomes async | agent-unreviewed | needs-review |
| D-0503 | dev messages: 'live reload on <url>'; 'watching <dir>' drops '(refresh the page after a push)' when live reload is on | agent-unreviewed | needs-review |
| D-0504 | Example theme tsconfig includes puck-remote.cli.ts (typechecked) | agent-unreviewed | needs-review |
| D-0505 | Docs: CLI Configuration page examples (env API key, token from a command, HMAC-signed requests via fetch); installation shows a puck-remote.cli.ts step | agent-unreviewed | needs-review |
| D-0506 | Store contract is files-per-theme: artifact ids, list() and writeArtifact() disappear | user | accepted |
| D-0507 | Partial pushes by manifest diff, for dev and push alike | user | accepted |
| D-0508 | Theme hash = sha256(manifest.json) computed by the core; no history (rollback = push an older checkout, --artifact removed); an unknown ?v= is served as the current file | user | accepted |
| D-0509 | Writes in place, Shopify-like: each file atomic (temp + rename), theme hash updated last; load-time manifest hash verification removed; asset ?v= requests check that file and answer no-cache on mismatch | user | accepted |
| D-0510 | Names kept: ArtifactStore, config key artifacts, package @puck-remote/artifacts-fs | user-approved-plan | accepted |
| D-0511 | Theme = { id, name, role: main\|unpublished\|development, hash: string\|null, createdAt, updatedAt }; null hash = no files yet | user-approved-plan | accepted |
| D-0512 | ArtifactStore: readThemes/writeThemes (CAS, unchanged), readFile(theme, path), writeFiles(theme, { put?, delete? }) atomic per file, copyFiles(from, to), deleteFiles(theme), watch?(onChange) | user-approved-plan | accepted |
| D-0513 | artifacts-fs: <dir>/themes.json + <dir>/themes/<id>/<path>; per-file temp + rename; copyFiles hard-links when possible; .themes.lock for the list (stale after 10 s) | user-approved-plan | accepted |
| D-0514 | Write path core.themes.writeFiles(id, package, { expect? }): validate new manifest; each listed file in the package with its sha256 or unchanged in the current manifest; unlisted package files refused; expect = hash (409); put files, manifest last, delete unlisted; list hash and updatedAt via CAS | user-approved-plan | accepted |
| D-0515 | Loader reads the main theme's manifest.json and bundle.js without per-file verification; reloads when the main hash changes; preview runtimes keyed by <themeId>:<hash> | user-approved-plan | accepted |
| D-0516 | Theme rules: create({ name, role }) makes an empty theme (hash null); publish and preview refuse themes without files (409 'theme <id> has no files yet'); duplicate copies files; delete and prune delete files | user-approved-plan | accepted |
| D-0517 | readTemplate(name, { theme? }) -> { theme, hash, data }; writeTemplate(name, data, { theme, expect? }) writes the template and manifest into the theme and returns { hash } | user-approved-plan | accepted |
| D-0518 | Assets ?v=: main theme if v matches, else any theme whose current manifest lists path+v (index refreshed on list change); bytes must match v for immutable, else no-cache + etag; no v -> main theme file no-cache | user-approved-plan | accepted |
| D-0519 | PreparedTemplate.theme { id, hash } replaces artifact; EditorPayload theme (id) + hash replace artifact; editor PROTOCOL_VERSION + 1 | user-approved-plan | accepted |
| D-0520 | API: GET/POST /themes (POST { name, role } -> empty theme), GET/PATCH ({ name })/DELETE /themes/<id>, publish, duplicate, POST /themes/<id>/files?expect= (package, full or partial), GET /themes/<id>/files/<path>; /artifacts removed; files upload is updateTheme, file reads are read | user-approved-plan | superseded by D-0552 |
| D-0521 | API limits unchanged, applied to uploaded packages | user-approved-plan | accepted |
| D-0522 | CLI pushes diff the theme's manifest (GET files/manifest.json, 404 = none) and upload only new or changed files plus manifest.json; dev sends expect = last pushed hash (409 -> re-diff and retry once) | user-approved-plan | accepted |
| D-0523 | CLI: push [-t] [--live] [--unpublished] [--name] [--file]; push/pull --artifact removed; --live/--unpublished create the empty theme first; publish -t; pull [-t]; dev [-t]; list; rename; delete; duplicate; share | user-approved-plan | accepted |
| D-0524 | dev logs the files it sent: '<name> -> N files (a, b)' | user-approved-plan | accepted |
| D-0525 | Example: themes.multiple true; theme library dashboard (Customize, Preview, Publish, Delete) showing the hash; editor save via core.writeTemplate(name, data, { theme, expect: hash }); data re-released without migration | user-approved-plan | accepted |
| D-0526 | Docs: store contract and in-place writes, artifacts concept rewritten, themes hash, HTTP API files endpoints and v lookup, core API, CLI diff push, guides, internal loader (no verification), threat model, known gaps (no history, mixed reads, concurrent pushes), testing | user-approved-plan | accepted |
| D-0527 | Tests: contract suite files-per-theme; fs per-file atomic writes; partial write validation and expect; hash = sha256(manifest); empty themes; duplicate/delete files; assets v across themes; API files endpoints; CLI diff per change type; dev over HTTP; editor save | user-approved-plan | accepted |
| D-0528 | core.themes.update replaced by rename(id, name) and writeFiles(id, files, { expect? }) | agent-unreviewed | needs-review |
| D-0529 | duplicate adds the theme with hash null, copies the files, then sets the hash (two list writes) | agent-unreviewed | needs-review |
| D-0530 | A main theme without files is not a main change (no reload); mainVersion counts only a main theme with a hash | agent-unreviewed | needs-review |
| D-0531 | Version key '<themeId>-<hash>' for runtimes, caches and warnings; logs show its first 25 characters (shortId) | agent-unreviewed | needs-review |
| D-0532 | ThemeFiles: path+v index rebuilt only when the theme list version changes; INDEX_REFRESH_MS removed; refreshes counter kept for tests | agent-unreviewed | needs-review |
| D-0533 | fs watch creates the store directory when missing, so the host notices the first push | agent-unreviewed | needs-review |
| D-0534 | dev and push log 'N files (a, b)' and 'no file changed' via describePush | agent-unreviewed | needs-review |
| D-0535 | dev: a 409 on expect re-diffs against the theme's current manifest and retries once without expect | agent-unreviewed | needs-review |
| D-0536 | SSE: GET /events text/event-stream, CORS *, ping every 15 s, event reload { theme, hash } after each push; other paths 404 | agent-unreviewed | needs-review |
| D-0537 | ApiAction kinds read\|list\|createTheme\|updateTheme\|publishTheme\|deleteTheme (upload removed: POST files is updateTheme) with theme { id?, name, role } | agent-unreviewed | needs-review |
| D-0538 | API error wordings: 'upload: manifest.json is missing', 'upload: bundle.js missing', 'upload: <rel> is not listed in manifest.files', 'upload: hash mismatch for <rel>', 'upload: <rel> is neither uploaded nor unchanged in theme <id>', 'theme <id> changed (expected …, found …)', 'theme <id> has no files yet'; expect must be 64 hex | agent-unreviewed | needs-review |
| D-0539 | push --file uploads the whole package (no diff) | agent-unreviewed | needs-review |
| D-0540 | push --live / --unpublished create the empty theme first, then push its files | agent-unreviewed | needs-review |
| D-0541 | Old example data moved to examples/app/data/artifacts.pre-theme-files (untracked) instead of deleted | agent-unreviewed | needs-review |
| D-0542 | no-dev-code bundle-sink allowlist adds server/themes.ts (it hashes uploaded bundles) | agent-unreviewed | needs-review |
| D-0543 | artifacts-fs no longer exports artifactHash | agent-unreviewed | needs-review |
| D-0544 | Test helpers: publish({ distDir, artifacts, role?, theme? }) returns { id: '<theme>-<hash>', theme, hash }; counterStore becomes an in-memory files store | agent-unreviewed | needs-review |
| D-0545 | previewUrl returns null for a theme without files | agent-unreviewed | needs-review |
| D-0546 | dev sends only the changed files on each change (per D-0507); 300 ms debounce, ignored dirs, failed build keeps the theme unchanged | agent-unreviewed | needs-review |
| D-0547 | routes.api default /api/themes, mounted by app/api/themes/[[...path]]/route.ts (no catch-all at /api); the handler has no themes sub-path | user | accepted |
| D-0548 | routes.preview default /theme/preview | user | accepted |
| D-0549 | routes.editor default /theme/editor (the editor frame page, still reached at / of origins.editor) | user | accepted |
| D-0550 | The CLI url is the artifacts API route itself (http://admin.localhost:3100/api/themes) | user | accepted |
| D-0551 | The example admin editor takes the template path as ?previewPath= (like Shopify), not in the URL path | user | accepted |
| D-0552 | Artifacts API paths relative to routes.api: '' (GET list, POST create), /<id> (GET, PATCH, DELETE), /<id>/publish, /<id>/duplicate, /<id>/files?expect=, GET /<id>/files/<path>; other paths 404; ApiAction kinds unchanged | user-approved-plan | accepted |
| D-0553 | CLI api-client calls '', /<id>, /<id>/files… under url; a 404 on a GET with a sub-path means no theme or no file | user-approved-plan | accepted |
| D-0554 | Proxy logic unchanged: routes.api exempt from the admin rewrite on host origins and 404 elsewhere; other /api/* rewritten under /admin | user-approved-plan | accepted |
| D-0555 | Example layout: (puck)/api/themes/[[...path]]/route.ts, (puck)/theme/preview/route.ts, (puck)/theme/editor/{page,EditorPage}.tsx; puck-remote/ folder removed; theme CLI config url /api/themes | user-approved-plan | accepted |
| D-0556 | Admin editor: previewPath mapped by normalizeSlug (absent or / -> home), invalid or repeated -> 404; params.path dropped; ?theme= kept; links stay /editor and /editor?theme=<id> | user-approved-plan | accepted |
| D-0557 | No redirects from the old /puck-remote/* and /editor paths (unpublished) | user-approved-plan | accepted |
| D-0558 | CLI API errors name the route itself '/' (e.g. 'GET /: 401 unauthorized') since paths are relative to url | agent-unreviewed | needs-review |
| D-0559 | Installation docs: admin page moved to app/admin/editor/page.tsx reading ?previewPath= (trimmed slashes, none -> home); app trees list api/themes, cdn, theme/editor and theme/preview; a theme/preview/route.ts tab added | agent-unreviewed | needs-review |
<!-- decisions:end -->

## Decision Record
### Options Considered
- Heads vs per-host mutable dev artifacts: heads (git-branch-like names over immutable artifacts)
  reuse content addressing and make go-live, rollback and dev pushes one operation.
- Pointer compatibility alias vs replacing the contract: replaced (packages unpublished).
- Preview: editor only vs editor + public cookie (owner chose both). Token reuses the D-0294 shape.
- Auth: core-built token check vs app `authorize(request, action)`: the app owns auth (D-0187);
  `action` lets it scope tokens to `dev-*` heads.
- Package format: nanotar (writer truncates paths > 100 bytes), own tar code, gzip(JSON), `tar`
  (owner chose `tar` 7.5.22, D-0434).
- Upload protocol: single package upload vs content-addressed per-file sync: single upload first.
- Themes store contract: one method per operation vs **list + compare-and-swap** (chosen, D-0451):
  adapters stay tiny and every rule (one main, single mode, expiry) is implemented once in core.
- Dev theme identity: per device in a user-level file (chosen, like Shopify CLI), per checkout, or
  per account (needs user identity from authorize).
- Expiry: lazy prune in the API + `core.themes.prune()` (chosen) vs a host timer vs none.
- CLI config: TS module (chosen, code can read env/keychain/sign) vs declarative JSON/TOML; request
  shaping via `headers` + `fetch` (chosen) vs only one of them.
- Fourth iteration, store contract: keep immutable artifacts and add a per-file sync on top, vs
  files per theme (owner chose files per theme, D-0506).
- Partial pushes: manifest diff on the CLI (chosen, D-0507) vs a server-side "missing files" query.
- Theme version: sha256(manifest) without history (chosen, D-0508) vs keeping older manifests for
  rollback.
- Write consistency: staged copy + atomic switch with load-time verification, vs in place like
  Shopify, each file atomic and the hash updated last (owner chose in place, D-0509). Shopify does
  not verify on load because its store is its own storage, written only through its API; the same
  now holds here.
- Live reload: SSE from the CLI with the preview page injecting a client (chosen) vs a Shopify-like
  local proxy injecting the script (heavy: cookies, CSP, assets) vs WebSocket (no gain one-way).

### Rationale
Owner answers U1–U4 in session; the remaining choices were proposed in the approved plan
(D-0407–D-0432). Implementation choices made without approval are recorded as agent-unreviewed
(D-0435–D-0443).

### Trade-offs Accepted
- Files per theme (fourth iteration): no history (rollback = push an older checkout); a reader may
  see mixed old and new files during a push; concurrent pushes to one theme are not serialized;
  stored files are trusted (not re-hashed on load). Unknown or mismatching `?v=` answers `no-cache`.
- `dev` re-uploads the whole package per push; no live reload.
- Dev pushes overwrite editor edits on that head (pull --head first).
- A preview link is a bearer credential for viewing one head until it expires.
- Each previewed head costs a sandbox (LRU max 3, idle 10 min).

## Implementation
### Public API / config changes
- sdk/host: ArtifactStore readHead/writeHead({expect})/deleteHead/listHeads/watch(head); LIVE_HEAD,
  HEAD_NAME, isHeadName, HeadConflictError, WriteHeadOptions, ApiAction, AuthorizeApi.
- core: handleArtifactsApi, handlePreview, createPreviewUrl, previewHead; `{ head }` on
  prepareTemplate/readTemplate/editorPayload/resolveBlockData; PreparedTemplate.preview; config
  routes.api, routes.preview, origins.site, preview { secret, ttlSeconds }, previewRuntimes
  { max, idleMs }, api { maxPackageBytes, maxUnpackedBytes, maxFiles }; PREVIEW_COOKIE (/edge too).
- next: createArtifactsHandler({ authorize }), createPreviewHandler(), loadEditor(name, { head }),
  loadTemplate reads the preview cookie; proxy passes routes.api on host origins only.
- cli: package, publish (API, --file, --head), pull (--head), activate (--head), heads, heads rm,
  dev; --url / PUCK_REMOTE_URL, PUCK_REMOTE_TOKEN; --artifacts and artifacts-fs dependency removed.
- artifacts-fs: heads/<name>.json, heads/.lock; current.json dropped.

### Docs pages touched
apps/docs/content/docs: core/adapters/artifact-store, core/adapters/testing, core/index,
core/entry-points, cli/index, cli/commands, cli/programmatic-api, sdk/host-contracts,
(framework)/configuration, http-api, environment, installation, quick-start, next-js/api,
concepts/artifacts, concepts/adapters, guides/publishing, guides/theme-development,
guides/payload, guides/theme-dev (new), internal/architecture/heads-and-preview (new),
artifact-loader, editor-lifecycle, threat-model, internal/quality/known-gaps, testing,
internal/contributing/docs, meta.json files.

Migration: stores need a `live` head; the example's artifacts are re-released (`release` with
PUCK_REMOTE_TOKEN=dev-token against the running host).

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
- Themes: `createArtifactsHandler` still exported PUT (heads); PATCH /themes got 405 through Next.
  Fixed (D-0476) with a test on the exported methods.
- A `dev` watcher left running from the heads verification (pkill pattern did not match
  `puck-remote.js dev`) built into the same output folder and caused EEXIST during the themes check;
  stopped.
- `createCore` is memoized per process: changing `themes.multiple` needs a restart (existing behavior).
- D-0462 was recorded as superseding D-0421 by mistake (D-0421's rules belong to the authorize
  decisions), then D-0471 superseded D-0421 too, breaking `pnpm adr check`. With the owner's approval,
  D-0421 was removed from D-0462's `supersedes` in adr-index.toml by hand. The same review found more
  off-by-one supersede links, corrected by hand with the owner's approval: D-0462 supersedes D-0423
  (not D-0425, back to accepted); D-0466 supersedes D-0430 and D-0419 (not D-0417, back to accepted,
  nor D-0418, now superseded by its restatement D-0480).
- nanotar's writer truncates names > 100 bytes: switched to `tar` (owner's choice, D-0434).
- fs watch missed the first head (heads/ created before the watcher attached): report existing
  heads when the folder appears (D-0442).
- The editor protocol's strict `origins` schema rejected the new `origins.site`; the frame hung on
  "Waiting for the admin page". editorPayload now sends `{ host, editor }` only (D-0441).
- Files-per-theme: the fs watcher was a no-op when the store folder did not exist yet (D-0533);
  an empty main theme triggered a reload (D-0530); `no-dev-code` flagged `themes.ts`, which hashes
  uploaded bundles (D-0542). Old example data (artifacts layout) was moved aside, not migrated
  (D-0541).
- Next refuses two dev servers in one app folder; the owner approved stopping the other session's
  server (PID 83965).

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
- Route paths iteration: build, tests (core 150 + 1 skipped, cli 20, editor 21, next 23),
  typecheck, lint:pkg, docs:build pass. On :3100: `release` pushed through `/api/themes`;
  `/api/themes` is 404 on the site, `/puck-remote/api/themes` and `/theme/editor` too; the editor
  frame loads from `127.0.0.1:3100/`; `/editor` opens home, `?previewPath=/search` the search
  template, invalid or repeated values 404; `dev` printed a `/theme/preview?token=…` link that
  previewed and reloaded after an asset push (1 file).
- Files-per-theme iteration: build, typecheck, tests (core 150 + 1 skipped, cli 20, editor 21,
  next 22), docs:build pass. Browser on :3100: `release` sent 7 files, a second release
  "no file changed"; `dev` sent 1 file for an asset edit, 1 for a template edit, 2 bundles for a
  block edit, and the preview reloaded each time; an editor save on the main theme changed only
  `manifest.json` and `templates/home.json`.
- CLI config and live reload iteration: build, typecheck, tests (core 148, cli 19, next 22,
  editor 21), lint:pkg, docs:build pass. Browser: `pnpm --filter theme release` with no env var
  (config header), wrong token → 401; `dev` printed a preview link with `&reload=`; the preview page
  reloaded by itself after editing hero.tsx (window marker gone, new heading); no CSP violation; the
  main site has no reload script and no loopback connect-src.
- Themes iteration: build, typecheck, tests (core 18 files / 142, cli 21, next 20, editor 19),
  lint:pkg, docs:build pass. Browser: push --live, two devices' dev themes
  (`Development (<hash>-MacBook-Pro-de-Benjamin-Lepas)`, 50 chars), previews isolated, dashboard
  library Delete/Publish (previous main → unpublished, site reloads), editor `?theme=`, share,
  single mode (dev/share refused, push → main).
- pnpm build, typecheck, test (core 16 files / 136 tests + cli + next + editor), lint:pkg,
  docs:build, check-docs-adr: pass.
- New suites: artifacts-api, preview, cli-api (two parallel dev sessions over HTTP); adapters
  (fs heads, CAS, stale lock, watch); proxy (API route, preview cookie); load-template (cookie).
- Browser (example app): release through the API, 401 on a wrong token, API 404 on site and editor
  origins, dev-a / dev-b pushes, preview cookie shows only dev-a's edit, exit returns to live,
  forged link 400, editor `?head=dev-a` loads that head and Publish moves only dev-a, dashboard
  lists heads with editor/preview links. Next turns the proxy's `private, no-store` into
  `no-store` on dynamic pages (still uncacheable).

## Outcome & Lessons
[Final results and lessons learned]

## Tags
artifacts cli security api
