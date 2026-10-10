/**
 * The framework-agnostic host runtime: loads remote theme artifacts (code + templates), renders
 * templates in the sandbox, resolves declarative data, and reads/writes templates inside artifacts.
 * Which template a route uses is the app's choice. Saving, publishing, drafts and history are
 * left to plugins built on readTemplate/writeTemplate and the artifact pointer. Frameworks bind to
 * it through plain functions (see @puck-remote/next).
 */
import type { ArtifactId } from "@puck-remote/sdk/host";
import {
  ConfigError,
  resolveConfig,
  type EditorOrigins,
  type HostConfig,
  type PuckRemoteConfig,
} from "./server/config.ts";
import { isArtifactId } from "./server/artifact-loader.ts";
import {
  blockDataSchema,
  resolveBlock,
  type BlockDataResult,
} from "./server/editor-rpc.ts";
import { createHost, type Host } from "./server/host.ts";
import { manifestSchema, type Manifest } from "./server/manifest-schema.ts";
import { rewriteMissing, type TemplateData } from "./server/page-tree.ts";
import { checkParams, readTemplate, stripResolved, writeTemplate } from "./server/templates.ts";
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
  artifact: ArtifactId;
  template: string;
  /** The params the app passed (data resolution in the editor uses them). */
  params: Record<string, string>;
  manifest: Manifest;
  /** Root fields and defaults: the app's merged with the theme's. */
  root: MergedRoot;
  /** The template (unknown blocks shown as placeholders), or an empty one when the artifact has none. */

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
  /** Resolve data and render every block of a template of the current artifact. null: no such template. */
  prepareTemplate(
    name: string,
    opts?: TemplateOptions,
  ): Promise<PreparedTemplate | null>;
  /** A template of an artifact (default: the current one), or null when it has no such template. */
  readTemplate(
    name: string,
    opts?: { artifact?: ArtifactId },
  ): Promise<{ artifact: ArtifactId; data: TemplateData } | null>;
  /**
   * Write a template into a copy of `base` and return the new artifact's id. Never moves the
   * pointer: going live is `config.artifacts.writePointer(id)`, decided by the caller.
   */
  writeTemplate(
    name: string,
    data: unknown,
    opts: { base: ArtifactId },
  ): Promise<{ id: ArtifactId }>;
  /** Data for one block in draft mode (the editor's resolveData). Only block name + props (and the template's params) come from the caller. */
  resolveBlockData(
    name: string,
    block: string,
    props: Record<string, unknown>,
    opts?: { params?: Record<string, string> },
  ): Promise<BlockDataResult>;
  /** What the admin page passes to <PuckEditorFrame>: template, root fields, manifest and theme URLs. Needs `origins`. */
  editorPayload(
    name: string,
    opts?: { artifact?: ArtifactId; params?: Record<string, string> },
  ): Promise<EditorPayload>;
  /** `<routes.theme>/assets/**`, `bundle.browser.js` and `bundle.islands.js`, versioned by `?v=` (GET/HEAD); CORS for the editor origin. */
  handleTheme(request: Request): Promise<Response>;
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
          "[puck-remote] no artifact could be loaded at startup:",
          r.error,
        );
      h.store.watch(config.artifactPollMs);
      return h;
    })());

  /** The current artifact's manifest, or a stored one (validated). */
  async function manifestOf(
    h: Host,
    id?: ArtifactId,
  ): Promise<{ id: ArtifactId; manifest: Manifest } | null> {
    const current = h.store.peek();
    if (!id || id === current?.id)
      return current ? { id: current.id, manifest: current.manifest } : null;
    if (!isArtifactId(id)) return null;
    const bytes = await config.artifacts.readFile(id, "manifest.json");
    if (!bytes) return null;
    const parsed = manifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return parsed.success ? { id, manifest: parsed.data } : null;
  }

  return {
    config,
    host,
    async prepareTemplate(name, opts = {}) {
      const h = await host();
      const current = h.store.peek();
      if (current) rootOf(config.root, current.id, current.manifest);
      return prepareTemplate(h, name, opts);
    },
    async readTemplate(name, opts = {}) {
      const m = await manifestOf(await host(), opts.artifact);
      if (!m) return null;
      const data = await readTemplate(config.artifacts, m.id, m.manifest, name);
      return data ? { artifact: m.id, data } : null;
    },
    async writeTemplate(name, data, opts) {
      return writeTemplate(config.artifacts, opts.base, name, data);
    },
    async resolveBlockData(name, block, props, opts = {}) {
      const input = blockDataSchema.parse({ template: name, block, props, params: opts.params });
      const h = await host();
      const { manifest, runtime } = h.store.get();
      let session: Promise<RenderSession> | null = null;
      try {
        return await resolveBlock(input, {
          manifest,
          config,
          source: h.source,
          http: h.http,
          site: config.site,
          session: () => (session ??= runtime.session()),
        });
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
      const m = await manifestOf(await host(), opts.artifact);
      if (!m)
        throw new Error(
          opts.artifact
            ? `artifact ${opts.artifact} not found`
            : "no artifact loaded",
        );
      const root = rootOf(config.root, m.id, m.manifest);
      const template = (await readTemplate(
        config.artifacts,
        m.id,
        m.manifest,
        name,
      )) ?? {
        root: { props: { ...root.defaultProps } },
        content: [],
      };
      const base = origins.host[0];
      return {
        artifact: m.id,
        template: name,
        params,
        manifest: m.manifest,
        root,
        data: rewriteMissing(stripResolved(template), m.manifest),
        bundleUrl: `${base}${themeFileUrl(config.routes.theme, "bundle.browser.js", m.manifest.files["bundle.browser.js"])}`,
        assetBase: `${base}${themeAssetBase(config.routes.theme)}`,
        origins,
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
