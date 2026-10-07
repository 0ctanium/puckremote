# Architecture: sandboxed React blocks for Puck (POC)

The claim this POC validates is that **untrusted React can drive a Puck editor and a server-rendered public site, while the host server never executes developer code outside `isolated-vm`.**

## 1. Verified environment and versions (2026-10-07)

| Package | Version | Notes |
|---|---|---|
| Node | 26.10.0 **arm64** | Must be native arm64. The x64 Node under Rosetta has no isolated-vm prebuild. |
| pnpm | 12.9.1 | Node 26 no longer ships corepack, so pnpm is installed globally. Builds are allowed only for `isolated-vm` and `esbuild` (`allowBuilds` in `pnpm-workspace.yaml`). |
| isolated-vm | 7.0.1 | Requires `engines >=24`. Ships a prebuild for `darwin-arm64` ABI 147. **The project is in maintenance mode** (README). |
| @puckeditor/core | 0.23.0 | This is the renamed `@measured/puck`, which stops at 0.20.2. The RSC entry is `@puckeditor/core/rsc`, also exposed through the `react-server` export condition. |
| next | 16.4.0 | App Router. `serverExternalPackages: ['isolated-vm']`. |
| react / react-dom | 19.3.0 | The same version is bundled into the isolate. |
| esbuild | 0.28.2 | CLI only. |
| zod | 4.6.5 | |
| html-react-parser | 6.1.8 | |
| undici | 8.11.2 | Requires Node ≥ 22.19. |
| vitest | 5.0.3 | |

### isolated-vm findings (spike in `/spike`)
- `--no-node-snapshot`: on Node 26.10 arm64 the spike ran fine **without** the flag. The README still mandates it for Node ≥ 20 because of known crashes with snapshot-deserialized contexts. It costs nothing, so every script sets `NODE_OPTIONS=--no-node-snapshot`.
- A bare context exposes `console` (a no-op unless wired up), `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval` and `Function`. `fetch`, `process`, `require`, `setTimeout`, `queueMicrotask`, `TextEncoder` and `MessageChannel` are all **undefined**.
- **Microtasks drain inside the synchronous call** (V8 runs a microtask checkpoint before `evalSync` returns), and **the `timeout` covers the drain.** `(async()=>{while(true) await null})()` is killed after the timeout (~225 ms with `timeout: 200`). The isolate is not disposed, and both the same context and new contexts keep working. With no timers there is no way to schedule work after the call returns, so async code can't outlive a call.
- Measured on an M1 Max with a 603 KB bundle (React + react-dom/server.browser):

| Step | Cost |
|---|---|
| `compileScript` (once per artifact) | ~17–50 ms |
| New context plus running the bundle in it (per request) | ~4–6 ms warm, ~10–25 ms first |
| `renderToString` of a small tree | ~0.5–2 ms warm, ~8 ms first |

### React in the isolate
- Build: `react-dom/server.browser`, using `renderToString`. esbuild settings are `platform: 'neutral'`, `conditions: ['browser']`, and `NODE_ENV=production`.
- **Minimal shims** (found empirically, removing one at a time):
  1. `MessageChannel`: the scheduler probes for it at module init. A stub whose `postMessage` is a no-op is enough because `renderToString` never yields.
  2. `TextEncoder`: Fizz's browser build instantiates it at module init. A UTF-8 `encode` and `encodeInto` stub is enough.
- `setTimeout`, `queueMicrotask` and `console` are **not** required for `renderToString`. They are deliberately left undefined so blocks can't schedule work.

## 2. Puck findings (read from the 0.23.0 sources and types)

| Topic | Finding | Consequence |
|---|---|---|
| `Config` | `{ components, root?, categories? }`. Each component has `render, label, defaultProps, fields, resolveFields, resolveData, resolvePermissions, permissions, inline, metadata`. | Only `render`, `label`, `defaultProps`, `fields`, `resolveFields` and `resolveData` are produced. All of them are host functions built from manifest JSON. |
| `slot` field | In `render`, a slot prop is a `SlotComponent` function `(props?) => ReactNode`. | The slot swap returns `<props[name] />`. |
| `resolveData(data, { changed, lastData, metadata, trigger, parent, root })` | `trigger ∈ 'insert'\|'replace'\|'load'\|'force'\|'move'`. The returned `props` are **merged into the item's props in app state**, and `readOnly` is stored on the item as `item.readOnly`. | **Resolved data persists into the saved page unless it is stripped.** We write it to the reserved prop `__data`, mark it `readOnly`, and strip `__data` and `readOnly.__data` from every node on save (`POST /api/pages`). Public renders always re-resolve. |
| `resolveAllData(data, config, metadata)` | Runs each node's `resolveData` with trigger `force`, **recursing into slot fields** (`mapFields → slot`) and into legacy `zones`. Each node is resolved independently. | It does reach nested blocks, but there is no global view, so dedupe and budget can't be done there. **The public render uses the host's own walker** (D1). |
| `root` | `RootConfig` supports `fields`, `defaultProps`, `resolveData`, `render`. Props are stored at `data.root.props`; the older "props directly on root" shape is still typed. Root `render` receives the page body as `children`. | `defineRoot`'s `<Slot name="children"/>` is swapped for `props.children`. |
| Unknown component type | `ServerRender`'s `DropZoneRenderItem` **returns `null` silently**. | We rewrite unknown types to a reserved `__missing` block before rendering (D2). |
| RSC renderer | `Render({ config, data, metadata })` from `@puckeditor/core/rsc`. Components get `puck: { metadata, isEditing: false, renderDropZone, dragRef: null }`. | `metadata` carries the per-request pre-rendered HTML map (D3). |
| `overrides` / `iframe` | The editor canvas is an iframe by default, and component `render` runs in the parent React tree, portalled into the iframe. `overrides.iframe` receives `{ children, document }`. | The editor bundle runs in the parent window. `overrides.iframe` injects theme CSS into the iframe document. |

## 3. Deviations from the original plan
- **D1. Host walker for public data.** The host walks the tree (root, content, slots, zones) with its own traversal, collects every instance's data specs, and only then resolves them, with dedupe and a static budget. `resolveAllData` is not used for the public path.
- **D2. Missing blocks.** Before data reaches Puck, unknown `type`s become `{ type: '__missing', props: { id, originalType, originalProps } }`. The editor's save path reverses this so unknown blocks survive an artifact downgrade. Public output is an empty `<div hidden data-missing-block="…">` (a failed block likewise renders `<div hidden data-block-error="…">`); the editor shows a visible "Missing block" box.
- **D3. Pre-render pass (public).** `resolve data → new isolate context → render root and every block → map id → {html, effects}`. Puck `Render` then gets lightweight components that only parse the pre-rendered HTML and swap slots. This yields `head` effects before markup and keeps "one fresh context per request".
- **D4. `<head>` merge** uses React 19 hoisting (`<title>`, `<meta>`, `<link rel="stylesheet" precedence>`, `<script async>`), deduped on the host.
- **D5. Editor rendering runs `bundle.js` in the browser** (the spec's preferred path). The editor loads `/theme-bundle/vN` into a **hidden same-origin iframe** and calls that realm's `__render` synchronously from each Puck component, with `__data` from `resolveData`. A separate realm is required because the isolate shims replace `MessageChannel` and `TextEncoder`; doing that in the editor window would break React DOM's scheduler. It also keeps global mutation by developer code away from the editor. **Gap:** this is not a security boundary. Developer JS runs on the host origin in the POC, and production must serve the editor from a separate origin. A synchronous infinite loop in a block also freezes the editor tab, since browsers have no way to interrupt a synchronous call. The *server* never evaluates developer code outside the isolate, and a test enforces this.
- **D6. Async host→isolate calls.** The host calls `Reference.apply` (async) rather than `applySync`. The isolate code is still fully synchronous, but the Node event loop stays free, so the wall-clock watchdog `setTimeout` can actually fire and dispose the isolate. A synchronous call would block the timer meant to stop it. This is possible because of D3: nothing has to render inside Puck's synchronous render pass.
- **D7. Cache headers.** Next.js marks every `force-dynamic` page `Cache-Control: no-store`. The proxy (`src/proxy.ts`, Node runtime in Next 16) adds `x-page-cacheable: true|false` and `x-uncacheable-blocks`, and sets `cache-control: no-store` for `$query` pages. A CDN or ISR layer would key on `x-page-cacheable`; the POC does no caching of its own beyond the query cache.

## 4. Build-time metadata extraction (developer machine, trusted)
`poc build`:
1. Uses esbuild to produce a Node ESM build of a generated entry that imports `blocks/*.tsx`, `root.tsx`, `adapters/*.ts` and `config/categories.ts`.
2. Imports that build in Node **on the developer's machine** and, for each definition, serializes `label, category, fields, defaultProps, data, visibleIf` (found inside fields) and `adapters[name].origin`. Building fails on:
   - any function other than `render` / `toRequest` / `fromResponse`
   - field types outside the allowlist, including `custom`, `external` and `richtext`
   - `permissions`, `resolveFields`, `resolvePermissions` or `resolveData` keys
   - non-plain objects: class instances, Dates, Maps, symbols, `undefined` in arrays, non-finite numbers
3. Computes `usesRequestParams` (any `$query` ref) for each block, and `propRefs` (a static list of `$prop` names) for each query.
4. Builds the isolate bundle: an IIFE made of the shims, React, `react-dom/server.browser`, the SDK runtime and the developer code. It exposes only `__render`, `__toRequest` and `__fromResponse`.
5. Writes `dist/manifest.json` with sha256 for every file, plus `dist/bundle.js` and `dist/assets/**`.

The host **re-validates** the manifest with zod and never trusts the CLI.

## 5. Isolate lifecycle
- **One `Isolate` per artifact version** (`memoryLimit: 64` MB). `compileScript(bundle)` runs once.
- **A fresh `Context` per page request** (and per editor RPC). The compiled script runs in it, then all of the request's calls go to that context, which is released at the end. Blocks within one request share a context; this is an accepted limitation, since a block can influence later blocks in the same request.
- Every call is `Reference.apply` with `timeout` (V8-enforced), plus a host-side wall-clock watchdog (see D6). If the isolate is disposed (OOM or watchdog), the runner recreates the isolate and recompiles lazily on the next request.
- Data crosses the boundary only as JSON strings, in both directions. No `Reference`s or host functions are exposed. Input and output sizes are capped.
- Effects (`head.title/meta`, `assets.script/style`) are collected into a capped array that `__render` returns next to `html`.

## 6. Slot-marker scheme
- `Slot` renders `<div data-puck-slot="NAME" data-nonce="NONCE"></div>`. `NONCE` is 128 random bits from the host, passed in `ctx`, and fresh per render call.
- When parsing the HTML, the host swaps a `div` for the real Puck slot **only if** `data-nonce === ctx.nonce`, `NAME` is a slot field of that block, and `NAME` hasn't been swapped yet. Any other marker, such as one forged in user content, is left as an inert empty div.
- A block's user content can't learn the nonce. It is not in props, and props are rendered by React with escaping.

## 7. Keeping `resolveData` out of saved pages
- Verified by test 18: running Puck's `resolveAllData` with the editor config yields data where every node, nested slots included, carries `props.__data` and `readOnly.__data`. That is the in-memory editor state, and it is what `onPublish` hands us.
- In the editor, `resolveData` calls `POST /api/blocks/resolve { blockType, props, slug }`. The response becomes `props.__data`, with `readOnly: { __data: true }`. It re-runs only when a prop named in the manifest's `propRefs` changed, or on `load`/`insert`.
- On save, `stripResolved(data)` removes `__data` and `readOnly.__data` from every node, recursing into slots. A test asserts that saved JSON never contains `__data`.

## 8. How the editor renders blocks
- `Puck` is given the editor config. Each component's `render` calls `window.__pocBundle.__render(kind, name, propsJson, dataJson, ctxJson)` synchronously, then parses the HTML with the same `slot-swap` used on the server.
- Parity: the same bundle, React version and `(props, data, ctx)` give byte-identical HTML. This is tested by running `bundle.js` in a separate `node:vm` realm (test-only), standing in for the browser realm, and comparing with the isolate's output.

## 9. Known limitations and gaps
- `isolated-vm` is V8-in-process and in maintenance mode. Hostile code in production needs an out-of-process renderer (a separate process or container per tenant, seccomp, and so on).
- The editor shares the host origin in the POC, so developer JS in the editor equals XSS on the host origin. Production needs a separate origin.
- Blocks in one request share a context.
- Puck's `resolveData` output persists into the editor's in-memory state. We strip it on save; this is a convention, not something Puck enforces.
- `$query` pages are uncacheable (`Cache-Control: no-store`).

## 10. Host plugins: data source and page store

The host core is backend-agnostic. It depends on Puck and on the `@poc/sdk/host` contracts; the concrete plugins are chosen in one file, `apps/host/poc.config.ts`.

| Contract | Example implementation | Purpose |
|---|---|---|
| `DataSource` (`defineDataSource`, `defineCollection<D>()`, `defineGlobal<D>()`) | `@poc/source-mock` | Answers theme `find` / `findByID` / `global` queries |
| `PageStore` (`get` / `put` / `list`) | `@poc/pages-fs` | Persists Puck page JSON |

**Trust.** Plugins are trusted host code chosen by the operator, so they run in Node. Theme `defineAdapter`s are different: untrusted, shipped by the theme, sans-IO, and run in the isolate.

**Enforcement lives in the host core** (`src/server/query/host-source.ts`), not in plugins:
- Declared collections, globals and fields only. `__proto__` and undeclared names are rejected.
- Per-field `filter` operator allowlists and `sort` flags.
- `limit` defaults and maxima, and `depth` clamped to `maxDepth`.
- Output projected to declared fields, recursing into populated relations with the target collection's policy.
- `mode` is set by the host only, and draft results are never cached.

Plugins receive a validated `NormalizedFind` and only implement storage semantics, including what "draft" means for them. A plugin's optional `subscribe` change feed drives tag-based cache invalidation.

**Typing.** Collection definitions carry a phantom document type. Theme queries are typed by registering the source type (`declare module '@poc/sdk' { interface Register { source: MockCms } }`) or via `source<MockCms>()`. The query spec is `{ source: 'host', op, collection, args }`. Changing it from `'payload'` was a breaking SDK change (`sdkMajor` 0 → 1), and the host rejects older artifacts with an explicit message.
