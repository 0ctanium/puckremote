/**
 * The framework-agnostic host runtime: loads remote theme artifacts (code + templates), renders
 * templates in the sandbox, resolves declarative data, and reads/writes templates inside artifacts.
 * Which template a route uses is the app's choice. Saving, publishing, drafts and history are
 * left to plugins built on readTemplate/writeTemplate and the themes. Frameworks bind to
 * it through plain functions (see @puck-remote/next).
 */
import type { AuthorizeApi, Theme } from "@puck-remote/sdk/host";
import { themeOps, type ThemeOps } from "./server/themes.ts";
import { handleArtifactsApi } from "./server/artifacts-api.ts";
import { handlePreview, previewUrl, verifyPreviewToken } from "./server/preview.ts";
import { reloadOrigin } from "./shared/preview-cookie.ts";
import {
  ConfigError,
  resolveConfig,
  type EditorOrigins,
  type HostConfig,
  type PuckRemoteConfig,
} from "./server/config.ts";
import { parseManifest, sha256, versionKey } from "./server/artifact-loader.ts";
import {
  blockDataSchema,
  resolveBlock,
  type BlockDataResult,
} from "./server/editor-rpc.ts";
import { createHost, type Host } from "./server/host.ts";
import type { Manifest } from "./server/manifest-schema.ts";
import { rewriteMissing, type TemplateData } from "./server/page-tree.ts";
import { checkParams, readTemplate, stripResolved, templateChanges, TemplateError } from "./server/templates.ts";
import { rootOf, type MergedRoot } from "./server/root.ts";
import {
  prepareTemplate,
  type PreparedTemplate,
  type TemplateOptions,
} from "./server/public-render.ts";
import type { RenderSession } from "./server/runtime/types.ts";
import { fileResponse, ThemeFiles } from "./server/static-files.ts";
import { themeAssetBase, themeFileUrl } from "./shared/urls.ts";

/** Everything the editor iframe needs to edit a template (JSON only; sent in the `init` message). */
export interface EditorPayload {
  /** The theme being edited. */
  theme: string;
  /** Its version when the editor opened (pass it as `expect` when saving). */
  hash: string;
  template: string;
  /** The params the app passed (data resolution in the editor uses them). */
  params: Record<string, string>;
  manifest: Manifest;
  /** Root fields and defaults: the app's merged with the theme's. */
  root: MergedRoot;
  /** The template (unknown blocks shown as placeholders), or an empty one when the theme has none. */
  data: TemplateData;
  /** Absolute URL of the theme's browser bundle (ESM). */
  bundleUrl: string;
  /** Absolute URL prefix of the theme's assets. */
  assetBase: string;
  /** Where the frame and the editor must run; both sides check them. */
  origins: EditorOrigins;
  /** For the render context of blocks in the editor. */
  site: { name: string; locale: string };
}

export interface PuckRemoteCore {
  config: HostConfig;
  /** Resolves once the first artifact load was attempted (loads lazily on first use). */
  host(): Promise<Host>;
  /** Resolve data and render every block of a template of the main theme (or `opts.theme`). null: no such template or theme. */
  prepareTemplate(
    name: string,
    opts?: TemplateOptions,
  ): Promise<PreparedTemplate | null>;
  /** A template of the main theme (or `opts.theme`); null when there is no such template or theme. */
  readTemplate(
    name: string,
    opts?: { theme?: string },
  ): Promise<{ theme: string; hash: string; data: TemplateData } | null>;
  /**
   * Save a template into a theme: writes templates/<name>.json and the updated manifest (the
   * theme's other files are untouched). With `expect`, refused (ThemeError 409) when the theme
   * changed since that hash. Returns the theme's new hash.
   */
  writeTemplate(
    name: string,
    data: unknown,
    opts: { theme: string; expect?: string },
  ): Promise<{ hash: string }>;
  /**
   * Data for one block (the editor's resolveData). Only block name + props (and the template's params) come from the caller.
   * `request` is forwarded to the data source, which decides who it is; none: anonymous.
   */
  resolveBlockData(
    name: string,
    block: string,
    props: Record<string, unknown>,
    opts?: { params?: Record<string, string>; theme?: string; request?: Request },
  ): Promise<BlockDataResult>;
  /** What the admin page passes to <PuckEditorFrame>: template, root fields, manifest and theme URLs. Needs `origins`. */
  editorPayload(
    name: string,
    opts?: { theme?: string; params?: Record<string, string> },
  ): Promise<EditorPayload>;
  /** `<routes.theme>/assets/**`, `bundle.browser.js` and `bundle.islands.js`, versioned by `?v=` (GET/HEAD); CORS for the editor origin. */
  handleTheme(request: Request): Promise<Response>;
  /** The site's themes (Shopify-like): list, create, rename, writeFiles, publish, delete, duplicate, prune. */
  themes: ThemeOps;
  /** The artifacts API under `routes.api` (uploads and themes, for the CLI). `authorize` is required. */
  handleArtifactsApi(request: Request, opts: { authorize: AuthorizeApi }): Promise<Response>;
  /** `routes.preview`: `?token=` starts a preview of a theme (cookie), `?exit` ends it. 404 when `preview` is not configured. */
  handlePreview(request: Request): Response;
  /** Signed link starting a preview of a theme on `origins.site`, or null (main theme, single-theme mode, no `preview` / `origins.site`). */
  createPreviewUrl(theme: Pick<Theme, "id" | "role"> & { hash?: string | null }): string | null;
  /** The theme id a preview cookie value selects, or null (invalid, expired, preview disabled). */
  previewTheme(cookieValue: string | null | undefined): string | null;
}

/** Path below a route prefix, or null if the request is outside it. */
function subpath(request: Request, prefix: string): string | null {
  const { pathname } = new URL(request.url);
  const p = prefix.replace(/\/+$/, "");
  if (pathname !== p && !pathname.startsWith(p + "/")) return null;
  return pathname.slice(p.length).replace(/^\/+/, "");
}

function build(config: HostConfig): PuckRemoteCore {
  const themeFiles = new ThemeFiles(config.artifacts);
  let hostP: Promise<Host> | null = null;
  const host = () =>
    (hostP ??= (async () => {
      const h = createHost(config);
      const r = await h.store.reload();
      if (!r.ok)
        console.error(
          "[puck-remote] no theme could be loaded at startup:",
          r.error,
        );
      h.store.watch(config.artifactPollMs);
      return h;
    })());

  const themes = themeOps(config, {
    // Serve a new main artifact right away instead of waiting for the watcher.
    onMainChange: async () => {
      if (hostP) await (await host()).store.reload();
    },
  });

  /** The theme (null: no such theme or no files yet), or none when `opts.theme` is not set. */
  async function themeOf(opts: { theme?: string }): Promise<(Theme & { hash: string }) | undefined | null> {
    if (opts.theme === undefined) return undefined;
    const t = await themes.get(opts.theme);
    return t?.hash ? (t as Theme & { hash: string }) : null;
  }

  /** The main theme's loaded version (with its runtime), or a theme's preview runtime. */
  function loadedOf(h: Host, theme: (Theme & { hash: string }) | undefined) {
    if (!theme) return h.store.get();
    return h.previews.get({ id: theme.id, hash: theme.hash });
  }

  /** A theme's manifest and hash (no runtime): the main one loaded, or read from the store. */
  async function manifestOf(
    h: Host,
    theme: (Theme & { hash: string }) | undefined,
  ): Promise<{ theme: string; hash: string; key: string; manifest: Manifest } | null> {
    if (!theme) {
      const current = h.store.peek();
      return current ? { theme: current.theme, hash: current.hash, key: current.id, manifest: current.manifest } : null;
    }
    const bytes = await config.artifacts.readFile(theme.id, "manifest.json");
    if (!bytes) return null;
    const hash = sha256(bytes);
    return { theme: theme.id, hash, key: versionKey(theme.id, hash), manifest: parseManifest(`theme ${theme.id}`, bytes) };
  }

  return {
    config,
    host,
    async prepareTemplate(name, opts = {}) {
      const h = await host();
      const theme = await themeOf(opts);
      if (theme === null) return null;
      const artifact = await loadedOf(h, theme);
      rootOf(config.root, artifact.id, artifact.manifest);
      const page = await prepareTemplate(h, name, opts, artifact);
      if (!page || !theme) return page;
      const reload = reloadOrigin(opts.reload);
      const preview = { theme: { id: theme.id, name: theme.name, role: theme.role }, ...(reload ? { reload } : {}) };
      return { ...page, preview, cacheable: false };
    },
    async readTemplate(name, opts = {}) {
      const theme = await themeOf(opts);
      if (theme === null) return null;
      const m = await manifestOf(await host(), theme);
      if (!m) return null;
      const data = await readTemplate(config.artifacts, m.theme, m.manifest, name);
      return data ? { theme: m.theme, hash: m.hash, data } : null;
    },
    async writeTemplate(name, data, opts) {
      const files = await templateChanges(config.artifacts, opts.theme, name, data);
      const t = await themes.writeFiles(opts.theme, files, opts.expect === undefined ? {} : { expect: opts.expect });
      return { hash: t.hash! };
    },
    async resolveBlockData(name, block, props, opts = {}) {
      const input = blockDataSchema.parse({ template: name, block, props, params: opts.params });
      const h = await host();
      const theme = await themeOf(opts);
      if (theme === null) throw new TemplateError(`unknown theme ${opts.theme}`);
      const { manifest, runtime } = await loadedOf(h, theme);
      let session: Promise<RenderSession> | null = null;
      try {
        return await resolveBlock(input, {
          manifest,
          config,
          source: h.source,
          http: h.http,
          site: config.site,
          session: () => (session ??= runtime.session()),
        }, opts.request);
      } finally {
        if (session)
          (
            await (session as Promise<RenderSession>).catch(() => null)
          )?.release();
      }
    },
    async editorPayload(name, opts = {}) {
      const params = checkParams(opts.params);
      const origins = config.origins;
      if (!origins)
        throw new ConfigError(
          "puck-remote: `origins` ({ admin, editor }) is required to use the editor",
        );
      const theme = await themeOf(opts);
      if (theme === null) throw new TemplateError(`unknown theme ${opts.theme}`);
      const m = await manifestOf(await host(), theme);
      if (!m) throw new Error(theme ? `theme ${theme.id} has no files` : "no theme loaded");
      const root = rootOf(config.root, m.key, m.manifest);
      const template = (await readTemplate(
        config.artifacts,
        m.theme,
        m.manifest,
        name,
      )) ?? {
        root: { props: { ...root.defaultProps } },
        content: [],
      };
      const base = origins.host[0];
      return {
        theme: m.theme,
        hash: m.hash,
        template: name,
        params,
        manifest: m.manifest,
        root,
        data: rewriteMissing(stripResolved(template), m.manifest),
        bundleUrl: `${base}${themeFileUrl(config.routes.theme, "bundle.browser.js", m.manifest.files["bundle.browser.js"])}`,
        assetBase: `${base}${themeAssetBase(config.routes.theme)}`,
        // The editor protocol knows host and editor only (origins.site is for preview links).
        origins: { host: origins.host, editor: origins.editor },
        site: config.site,
      };
    },
    async handleTheme(request) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      const sub = subpath(request, config.routes.theme);
      const v = new URL(request.url).searchParams.get("v");
      const res = fileResponse(
        sub ? await themeFiles.get(sub, v) : null,
        request,
      );
      // The editor (another origin) loads the browser bundle as a module and the assets in its canvas.
      if (config.origins && res.ok) {
        res.headers.set("access-control-allow-origin", config.origins.editor);
        res.headers.set("vary", "origin");
        res.headers.set("cross-origin-resource-policy", "cross-origin");
      }
      return res;
    },
    themes,
    async handleArtifactsApi(request, opts) {
      return handleArtifactsApi(config, themes, subpath(request, config.routes.api), request, {
        authorize: opts?.authorize,
      });
    },
    handlePreview(request) {
      return handlePreview(config, request);
    },
    createPreviewUrl(theme) {
      return previewUrl(config, theme);
    },
    previewTheme(cookieValue) {
      if (!config.preview || !cookieValue) return null;
      return verifyPreviewToken(config.preview, cookieValue)?.theme ?? null;
    },
  };
}

/**
 * Process-wide runtime for a config, memoized on globalThis by `config.id` so every route
 * bundle (and dev HMR) shares one artifact store, isolate and file watcher.
 */
export function createCore(input: PuckRemoteConfig): PuckRemoteCore {
  const config = resolveConfig(input);
  const key = Symbol.for(`remote.core:${config.id}`);
  const g = globalThis as typeof globalThis & {
    [k: symbol]: PuckRemoteCore | undefined;
  };
  return (g[key] ??= build(config));
}
