# Sandboxed React blocks for Puck (POC)

Developers write Puck blocks in React with `defineBlock(...)`. A CLI builds them into a versioned artifact (manifest + bundle + assets).

The host never builds and never runs developer code outside `isolated-vm`:

- It builds real Puck configs from the manifest's JSON.
- It runs every data query itself: declarative, validated, deduped and budgeted, against a **pluggable data source** that the host operator wires in. The host core is backend-agnostic and depends only on Puck plus the `@poc/sdk/host` contracts.
- It executes only the synchronous `render` functions and adapter translators, inside an isolate.

Block output is an HTML string with nonce-protected slot markers. The host swaps those markers for real Puck slots, and the public site is served with Puck's RSC renderer.

**Result: the central claim holds.** Untrusted React drives both the Puck editor and a server-rendered public site. On the server, developer code only ever executes inside the isolate. See [Findings](#findings) for what that cost and where the edges are, and [ARCHITECTURE.md](ARCHITECTURE.md) for the verified design.

## Requirements

- **Native arm64 Node 26** (`node -p process.arch` → `arm64`). isolated-vm 7.0.1 ships prebuilds for darwin-arm64 ABI 147 but not darwin-x64, so an x64 Node under Rosetta won't work. `.nvmrc` / `.node-version` say `26`.
- pnpm ≥ 12 (`npm i -g pnpm`; Node 26 no longer bundles corepack).
- Every script sets `NODE_OPTIONS=--no-node-snapshot`, as isolated-vm requires on Node ≥ 20.

## Run it

```bash
pnpm install
```

```bash
pnpm --filter theme release
```

`release` runs `poc build && poc publish` and produces `artifacts/v1` and `current.json`.

```bash
pnpm --filter mock-api start
```

The mock external API runs on http://localhost:4010 and serves the events adapter.

```bash
pnpm --filter host dev
```

The host runs on http://localhost:3100. Set `PORT=…` to change it.

- Public site: http://localhost:3100/ and http://localhost:3100/search?q=nonce. The search page is uncacheable.
- Editor: http://localhost:3100/editor and http://localhost:3100/editor/search.

To publish a new theme version, edit `examples/theme` and run `pnpm --filter theme release`. The host's file watcher picks up `current.json` and swaps in the new artifact (new isolate, old one disposed) with no host rebuild or restart. The editor picks it up on page reload or via its **Reload theme** button.

Rollback is just moving the pointer:

```bash
cd examples/theme && ./node_modules/.bin/poc activate 1 --artifacts ../../artifacts
```

Tests (58, covering every item in the spec's list):

```bash
pnpm test
```

Rough cost measurements (needs a published artifact and the mock API running):

```bash
pnpm --filter @poc/core bench
```

## Integrating into a Next app

All logic lives in `@poc/core` (framework-agnostic) and `@poc/next` (thin bindings). The app in `apps/host` is only wiring:

```ts
// poc.config.ts — the only file that knows the backend
export default definePocConfig({
  artifactsDir, source: mockCms({ dataFile }), pages: fsPageStore({ dir }),
  site: { name: 'POC Site', locale: 'en' }, http: { allowedOrigins }, secrets,
  // routes: { api: '/api', theme: '/theme', editor: '/editor' }   (defaults)
})

// src/poc.ts
export const poc = createPoc(config)

// src/proxy.ts — cache headers ($query pages are no-store); matcher must be a literal
export const proxy = createProxy(pocConfig)
export const config = { matcher: ['/((?!_next/|api/|editor(?:/|$)|theme/|favicon\\.ico).*)'] }

// src/app/[[...path]]/page.tsx — public site (Puck RSC)
export const dynamic = 'force-dynamic'
export const generateMetadata = poc.generateMetadata
export default async function Page(props: PageProps) {
  const page = await poc.loadPage(props /*, { locale } */)
  return <PocPage page={page} />
}

// src/app/editor/[[...path]]/page.tsx
export default async (props) => <EditorClient {...await poc.loadEditor(props)} />

// src/app/api/[[...path]]/route.ts — pages, blocks/resolve, artifact/reload
export const { GET, POST } = poc.api

// src/app/theme/[[...path]]/route.ts — /theme/v<N>/bundle.js (editor only) and /theme/v<N>/assets/**
export const { GET, HEAD } = poc.theme

// next.config.ts — isolated-vm external, POC packages transpiled
export default withPoc({ /* your config */ })
```

Other frameworks can bind to `createPocCore(config)` from `@poc/core` directly: `preparePage(slug, query, context)` with `<PocPage>`, `loadEditor(slug)` with `<EditorClient>`, and the fetch-style `handleApi(request)` / `handleTheme(request)`.

**Package boundaries.** `@poc/sdk` is deliberately not merged with the engine:
- **Different audience and trust level.** The SDK is the only package themes depend on, and it is bundled into the untrusted isolate code. The engine needs isolated-vm, zod, undici and Puck's editor, which themes must never install.
- **The SDK is the versioned bridge.** It holds the theme API, the QuerySpec/manifest contract (`sdkMajor`) and the adapter contracts (`@poc/sdk/host`), which adapter packages and the engine share. The engine can change freely behind it.

## Layout

```
packages/sdk        @poc/sdk: defineBlock/defineRoot/defineAdapter, Slot, typed query builders, isolate runtime + shims
                    @poc/sdk/host: contracts for trusted host plugins (DataSource, PageStore)
packages/cli        @poc/cli: `poc build | publish | activate`; metadata extraction + validation
packages/core       @poc/core: the framework-agnostic host engine (no Next imports)
  src/core.ts         createPocCore(config): preparePage, loadEditor, handleApi, handleTheme (fetch Request → Response)
  src/server/         artifact loader, isolate runner, query resolver (data source enforcement, http/adapters), page pipeline
  src/react/          <PocPage> (RSC-safe public render) + pageMetadata
  src/editor/         'use client' EditorClient, Puck editor config, host-owned field UIs, bundle realm loader
  src/shared/         slot swap + URL layout, shared by server and editor
  test/               vitest suites (sandbox, data, rendering, editor, artifacts, routes, no-dev-code)
packages/next       @poc/next: Next.js App Router bindings (createPoc, createProxy, withPoc)
packages/source-mock  @poc/source-mock: example DataSource (in-memory CMS: posts, authors, site global)
packages/pages-fs   @poc/pages-fs: example PageStore (JSON files)
apps/host           the Next.js app: ~80 lines of wiring, see "Integrating into a Next app"
examples/theme      the "developer repo"
mock/api-server     external API stand-in (events, redirects, big/slow responses)
artifacts/          published versions (git-ignored) + current.json
data/pages          saved Puck page JSON;  data/cms.json  seed data for the mock data source
spike/              Step 0 spike: isolated-vm + React renderToString in a bare isolate
```

## SDK reference (`@poc/sdk`)

### `defineBlock({ label?, category?, fields, defaultProps?, data?, render })`

One file per block, `blocks/<slug>.tsx`, default export. Everything except `render` must be plain JSON. It is extracted at build time and re-validated by the host.

```tsx
import { defineBlock, find, Slot } from '@poc/sdk'

export default defineBlock({
  label: 'Latest posts',
  category: 'Content',
  fields: {
    heading: { type: 'text' },
    count: { type: 'number', min: 1, max: 12 },
    layout: { type: 'select', options: [{ label: 'List', value: 'list' }, { label: 'Grid', value: 'grid' }] },
    columns: { type: 'number', visibleIf: { field: 'layout', eq: 'grid' } },
    content: { type: 'slot' },
  },
  defaultProps: { heading: 'Latest', count: 3, layout: 'list' },
  data: {
    posts: find<{ title: string; slug: string }>('posts', {
      limit: { $prop: 'count' },
      sort: '-publishedAt',
      select: ['title', 'slug'],
      where: { status: { equals: 'published' } },
    }),
  },
  render: (props, data, ctx) => (
    <section>
      <h2>{props.heading}</h2>
      {data.posts.ok ? data.posts.data.docs.map((p) => <h3 key={p.slug}>{p.title}</h3>) : <p>Unavailable</p>}
      <Slot name="content" />
    </section>
  ),
})
```

**Field types.** `text`, `textarea`, `number` (`min`, `max`, `step`), `select`/`radio` (`options: [{label, value}]`), `array` (`arrayFields`, `itemSummary: '<subfield>'`, `defaultItemProps`, `min`, `max`), `object` (`objectFields`), `slot` (`allow`, `disallow`; top level only).

**Host-owned field types.** `host:color` gives a string, `host:media` gives `{url, alt?}`, and `host:link` gives `{href, label?, newTab?}`.

Anything else fails the build: `custom`, `external`, `richtext`, any function-valued option, `permissions`, `resolveFields`, `resolvePermissions`, `resolveData`, and non-JSON values.

**`visibleIf`** is data only: `{ field, eq | in | not }`, `{ and: [...] }` or `{ or: [...] }`. It is evaluated by the host as Puck `resolveFields`, and is applied to top-level fields.

**`render(props, data, ctx)`** must be synchronous and pure. It runs in the isolate on the server and in a hidden iframe realm in the editor. Each `data` key is a `QueryResult<T> = { ok: true, data: T } | { ok: false, error: string }`; the type forces you to handle the failure case. Error codes include `budget`, `blocked`, `forbidden`, `timeout`, `secret`, `adapter`, `http-status`, `too-large` and `loading` (editor only, before data arrives).

**`ctx`** contains:

| Member | Meaning |
|---|---|
| `isEditing`, `locale`, `nonce`, `page.slug`, `site.name` | Request context |
| `assetUrl(path)` | Returns `/theme/v<N>/assets/<path>` (prefix from `routes.theme`). Traversal is rejected. |
| `assets.script(url, { defer?, async?, module? })`, `assets.style(url)` | Recorded effects |
| `head.title(t)`, `head.meta(name, content)` | Recorded effects |

Effects are the only channel out of the isolate. They are capped at 64 per render and 2 KB per string, merged and deduped by the host, and hoisted into `<head>`. URLs must be this artifact's assets or `https:`.

**`<Slot name="…" />`** renders `<div data-puck-slot="name" data-nonce="…">`. The host swaps a marker only if its nonce matches the per-render nonce and the name is a declared slot, and each slot at most once.

### `defineRoot({ fields, defaultProps?, data?, render })`

Lives in `root.tsx` and follows the same rules. The page body is `<Slot name="children" />`.

### Queries (JSON descriptors; the host executes them)

| Builder | Source |
|---|---|
| `find(collection, { where, limit, sort, select, depth, page })` | Host data source |
| `findByID(collection, id, { select?, depth? })` | Host data source |
| `global(slug)` | Host data source |
| `query(adapterName, op, params)` | Adapter |
| `http({ origin, path, method?, params?, headers? })` | Generic JSON endpoint, size-capped |

**Param refs:** `{ $prop: 'x' }`, `{ $page: 'slug' | 'locale' }`, `{ $site: 'locale' | 'name' }`, `{ $query: 'q' }`, and `{ $secret: 'NAME' }` (headers only). Using `$query` makes every page containing that block uncacheable.

**`where` operators:** `equals`, `in`, `contains`, `gt`, `lt`, `and`, `or`.

**Typing.** Host queries are typed from the host's data source type. Register it once in the theme (type-only; nothing from the source package enters the bundle):

```ts
// examples/theme/poc-env.d.ts
import type { MockCms } from '@poc/source-mock'
declare module '@poc/sdk' { interface Register { source: MockCms } }
```

After that, `find('posts', { select: ['title', 'slug'] })` returns `QuerySpec<FindResult<Pick<Post, 'id' | 'title' | 'slug'>>>`. Unknown collections, fields, sort keys and globals are compile errors (`examples/theme/type-tests.ts`).

Without registration, use `source<MockCms>().find('posts', …)`. A plain `find<MockCms>('posts')` isn't offered because TypeScript can't infer the collection name once one generic is given explicitly.

### `defineAdapter({ name, origin, toRequest(q), fromResponse(json, q) })`

Lives in `adapters/*.ts`. Adapters are sans-IO: both functions are synchronous and run in the isolate. `toRequest` returns `{ method, path, params?, headers? }`, and headers may contain `{ $secret }`. The host performs the request against the manifest's `origin`.

### Host plugins (`@poc/sdk/host`, trusted, run in Node)

The operator wires these in `apps/host/poc.config.ts`. Themes never ship them.

**`defineDataSource({ name, collections, globals, subscribe? })`** backs `find` / `findByID` / `global`. Collections declare their policy and implement storage:

```ts
posts: defineCollection<Post>()({
  fields: {                                      // exposed fields; everything else is invisible
    title: { type: 'text' },                     // filter: all operators, sortable
    slug: { type: 'text', filter: ['equals', 'in'] },
    excerpt: { type: 'text', filter: false, sort: false },
    author: { type: 'relation', to: 'authors' }, // populated docs use the authors policy
  },
  limits: { default: 10, max: 12, maxDepth: 1 },
  tags: ['posts'],                               // cache tags (default `collection:<name>`)
  find: async (query, ctx) => ({ docs, totalDocs }),  // query is validated + normalized
  findByID: async (id, { select, depth }, ctx) => doc, // optional; falls back to find
}),
```

The host core enforces the policy around every call:
- Only declared collections, globals and fields can be reached.
- `where` operators are checked per field, and `sort` only on sortable fields.
- `limit` and `depth` are clamped.
- Output is projected to declared fields, recursively through populated relations.
- `mode` (`public`/`draft`) is decided by the host only.

The plugin receives a `NormalizedFind` (`where` tree, `sort`, `limit`, `page`, `select`, `depth`) and translates it for its own backend. Visibility semantics (what "draft" means) belong to the plugin. The optional `subscribe(onChange)` feed lets the host invalidate cached results by tag.

**`PageStore`** (`get`, `put`, `list`) persists page JSON. The host validates pages and strips resolved data before `put`.

Theme `defineAdapter`s are a different thing: untrusted, sandboxed, sans-IO adapters to external HTTP APIs, shipped by the theme.

### CLI

- `poc build [--cwd .] [--out dist]` writes `dist/manifest.json`, `dist/bundle.js` and `dist/assets/**`.
- `poc publish --artifacts <dir>` copies to `v<N+1>` (temp dir, then rename) and switches `current.json` atomically (temp file, then rename).
- `poc activate <N> --artifacts <dir>` repoints `current.json`; this is how you roll back.

## Test map

| # | Test | Where |
|---|---|---|
| 1–6 | Sandbox: no fetch/process/require/env/timers; `while(true)`; await and timer loops; OOM then recreate; no cross-request pollution; size caps | `packages/core/test/sandbox.test.ts`; page-level 2 in `rendering.test.tsx` |
| 7 | SSRF: private/loopback/link-local literals, DNS to private, DNS rebinding (pinned lookup), redirects (other origin, private, loops), allowlist, size cap | `data.test.ts` |
| 8 | Secrets never in isolate inputs or logs; origin-bound | `data.test.ts` |
| 9 | Dedupe: identical queries cause one outbound request | `data.test.ts` |
| 10 | Budget: query count, response bytes, wall time; tree-order degradation | `data.test.ts` |
| 11 | `/api/blocks/resolve` ignores client-supplied spec/data/query/mode | `data.test.ts` |
| 12 | Drafts only in editor mode; no cache bleed | `data.test.ts` |
| 13 | Host data source policy: undeclared collections/globals/fields, per-field operators, sortability, `limit`/`depth` clamps, projection incl. populated relations, change-feed cache invalidation | `data.test.ts` (types: `examples/theme/type-tests.ts`) |
| 14 | Forged slot markers are not swapped; each slot is swapped once | `rendering.test.tsx` |
| 15 | hero → card → latest-posts nested via slots, with host data source and adapter data and head effects | `rendering.test.tsx` |
| 16 | Parity: isolate vs browser-realm HTML per block, and whole page editor config vs RSC | `editor.test.tsx` |
| 17 | Missing block fallback; stale or missing props | `rendering.test.tsx` |
| 18 | `resolveData` output (`__data`, `readOnly`) is stripped on save | `editor.test.tsx` |
| 19 | Tampered bundle, manifest or asset is rejected; previous version keeps serving | `artifacts.test.ts` |
| 20 | Publish increments; atomic pointer under concurrent reads; hot swap disposes old isolate; rollback | `artifacts.test.ts` |
| 21 | Build rejects function options, custom/external, permissions/resolve*, non-JSON, expression `visibleIf`, bad refs | `packages/cli/test/build.test.ts` |
| — | Framework-agnostic entry points: `handleApi` / `handleTheme` routing, prefixes, 404/405, memoized runtime | `routes.test.ts` |
| A7 | No developer code outside the isolate: static scan, bundle-sink allowlist, runtime realm check; host core imports only `@poc/sdk/host`, concrete plugins only in `poc.config.ts` | `no-dev-code.test.ts` |

## Findings

### What worked

- **isolated-vm and React 19 `renderToString` in a bare context** need only **two shims**: a no-op `MessageChannel` (the scheduler probes it at module init) and a UTF-8 `TextEncoder` (Fizz instantiates it at init). No `setTimeout`, `queueMicrotask`, `console`, `process` or `fetch` are needed, and none are provided.
- **Async can't escape a call.** V8 drains microtasks before `apply` returns, so an `await` loop runs under the call's timeout and is killed. There are no timers, so nothing can be scheduled for later.
- **Memory blow-ups are contained.** A 64 MB limit makes the isolate dispose itself. The runner recreates it lazily and the rest of the page still renders.
- **Fresh context per request** stops `Object.prototype` and global pollution from crossing requests. Within one request, blocks share a context; this is accepted and tested.
- **Declarative data works.** Dedupe, the static budget, draft/public separation, per-collection data source policy, origin-bound secrets and SSRF defenses are all enforced on the host, and secrets never reach the isolate. Theme adapters stay sans-IO.
- **Puck integration from pure JSON.** Both configs (editor and RSC) are built from manifest metadata. Slots render nested sandboxed blocks in both the editor and the public site. Editor HTML is byte-identical to public HTML for the same inputs.
- **Artifact swap without a host rebuild.** The file watcher, hash verification and zod validation run first; on failure the last good version keeps serving. Rollback is a pointer write.

### What was awkward with Puck (0.23.0, `@puckeditor/core`)

- **Unknown component types render nothing, silently** (`ServerRender` returns `null`). The host rewrites them to a `__missing` block before Puck sees the data, and reverses that on save.
- **`resolveData` output is merged into the item's props, and `readOnly` into the item.** It lands in the data `onPublish` receives (verified by test 18). Keeping it out of saved pages is our convention (`__data` stripped on save), not something Puck enforces.
- **`resolveAllData` reaches slot content** but resolves node by node. You can't dedupe or budget across the page that way, so public rendering uses the host's own tree walker. The editor's per-block `resolveData` uses a server RPC.
- **Puck renders components synchronously.** We pre-render the whole page in the isolate before calling `<Render>`, and pass HTML through `metadata`. This also lets `<head>` effects be known up front.
- **The RSC renderer needs `fields` in the config** to know which props are slots, even though it never shows fields.
- **The canvas is an iframe**, so theme CSS has to be injected through `overrides.iframe`. Component `render` runs in the parent window.
- **Select options are JSON-encoded in the DOM** and drag-and-drop requires trusted pointer events. Both only matter for browser automation.
- `getItemSummary` is a function, so a declarative `itemSummary: '<field>'` maps to a host function.

### Measured costs (M1 Max, arm64 Node 26.10, 221 KB bundle, `pnpm --filter @poc/core bench`)

| Step | Cost |
|---|---|
| Isolate create + `compileScript` (once per artifact) | ~17 ms |
| Fresh context + run bundle (per page request) | ~6 ms (median) |
| Render one block | ~0.3 ms median, ~1 ms p95 |
| `preparePage('home')`, 8 blocks, warm data | ~13 ms (context 5, render 7, data 0.4) |
| Same page, cold data (4 unique queries incl. mock HTTP) | ~56 ms data |

Per-request cost is dominated by context creation. If that matters, a pool of pre-warmed contexts discarded after each use keeps the "fresh context per request" property.

### Gaps (accepted for the POC)

- **isolated-vm is V8-in-process and in maintenance mode.** Hostile code in production needs an out-of-process renderer: a separate process or container, seccomp, and per-tenant isolation.
- **The editor runs developer JS on the host origin** (hidden same-origin iframe). Production needs a separate editor origin. A synchronous infinite loop in a block freezes the editor tab; a worker can't help because Puck render is synchronous.
- Blocks in one request share a context and can affect each other.
- `enhance.js`-style client scripts aren't run in the editor canvas, only on the public site.
- Next.js marks dynamic pages `no-store`. `x-page-cacheable` is the signal a CDN or ISR layer would act on.
- No `$ref` dependent queries, no pagination, no auth (all out of scope).

### Before integrating with Payload

1. Write a `@poc/source-payload` DataSource: translate `NormalizedFind` to the Payload Local API with `overrideAccess: false`, a public (or draft-preview) user, and `draft: ctx.mode === 'draft'`. Generate the collection policies from Payload collection configs if convenient. Emit `afterChange` hooks through `subscribe` for cache invalidation. Wire it in `poc.config.ts`; the host core doesn't change. A `PageStore` backed by a Payload collection replaces `@poc/pages-fs`.
2. Serve the editor from its **own origin**. Load the theme bundle there, or switch the editor to a server-render RPC if developer JS in the admin realm is unacceptable.
3. Move rendering of hostile code **out of process**, behind the same `__render` / `__toRequest` / `__fromResponse` JSON protocol. The protocol is already JSON-strings-only, so the transport can change without touching blocks.
4. Replace the local `artifacts/` directory and file watcher with an upload API: verify hashes, sign manifests, store versions immutably, and keep the pointer in the database.
5. Add per-tenant artifacts, isolates and secrets when multi-tenancy arrives. The secret-to-origin binding already exists.
