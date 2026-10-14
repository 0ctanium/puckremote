/**
 * Next.js App Router bindings. All logic lives in @puck-remote/core; these only adapt Next's
 * params/searchParams/notFound/route-handler conventions.
 *
 *   // src/puck-remote.ts
 *   export const remote = createPuckRemote(config)
 *   // any route of the app (it picks the template and its params):
 *   //   const template = await remote.loadTemplate('product', { params: { handle } })
 *   //   → <PuckRemoteTemplate template={template} />; metadata from template.data.root.props
 *   // app/admin/[[...path]]/page.tsx      → <PuckEditorFrame payload={await remote.loadEditor(name)} … />
 *   // app/theme/editor/page.tsx           → <PuckRemoteEditor {...await remote.loadEditorPage()} … /> (on origins.editor)
 *   // app/cdn/[[...path]]/route.ts        → export const { GET, HEAD } = remote.createThemeHandler()
 *   // app/api/themes/[[...path]]/route.ts → export const { GET, POST, PATCH, DELETE } = remote.createArtifactsHandler({ authorize })
 *   // app/theme/preview/route.ts          → export const { GET } = remote.createPreviewHandler()
 */
import {
  createCore,
  type EditorPayload,
  type PuckRemoteConfig,
  type PuckRemoteCore,
  type PreparedTemplate,
} from "@puck-remote/core";
import { requestOrigin } from "@puck-remote/core/edge";
import { PREVIEW_COOKIE, RELOAD_COOKIE, type AuthorizeApi } from "@puck-remote/core";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

export { PuckRemoteTemplate } from "@puck-remote/core/react";
export type { EditorPayload, PuckRemoteConfig, PreparedTemplate };
export type { ApiAction, AuthorizeApi } from "@puck-remote/core";

type Params = Promise<{ path?: string[] }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
/** Props Next passes to a catch-all page (`[[...path]]`). */
export interface RouteProps {
  params: Params;
  searchParams?: SearchParams;
}

export interface LoadTemplateOptions {
  /** Page-specific data for the template (e.g. { handle }), read by `$params` refs and `ctx.params`. */
  params?: Record<string, string>;
  /** The page's searchParams, read by `$query` refs. */
  searchParams?: SearchParams;
  /** Overrides the site locale (e.g. from i18n routing). */
  locale?: string;
}

export interface PuckRemote {
  core: PuckRemoteCore;
  /**
   * Resolve data and render every block of a template in the isolate. Calls notFound() for
   * unknown templates and on host origins. Memoized per request (metadata and page share it).
   * With a valid preview cookie, renders the previewed theme (`template.preview` is then set).
   */
  loadTemplate(name: string, opts?: LoadTemplateOptions): Promise<PreparedTemplate>;
  /**
   * The current request rebuilt from headers() (server components and server actions have no
   * Request): the headers and the origin root as URL (`<proto>://<host>/`), not the path. Pass it
   * as `request` to core.resolveBlockData so the data source sees who is asking.
   */
  currentRequest(): Promise<Request>;
  /** The editor payload for an admin page. Calls notFound() outside origins.host. */
  loadEditor(
    name: string,
    opts?: { params?: Record<string, string>; theme?: string },
  ): Promise<EditorPayload>;
  /**
   * Props for <PuckRemoteEditor> on the app's editor page (`<routes.editor>/[[...path]]/page.tsx`).
   * Calls notFound() outside origins.editor; createProxy rewrites that origin to this page.
   */
  loadEditorPage(): Promise<{ allowedParents: string[] }>;
  /** GET and HEAD for `<routes.theme>/[[...path]]/route.ts` (default `/cdn`: theme assets and bundles, `?v=` versioned). */
  createThemeHandler(): {
    GET: (req: Request) => Promise<Response>;
    HEAD: (req: Request) => Promise<Response>;
  };
  /**
   * Route handlers for `<routes.api>/[[...path]]/route.ts` (default `/api/themes`): the
   * artifacts API the CLI publishes through. `authorize` is required; host origins only.
   */
  createArtifactsHandler(opts: { authorize: AuthorizeApi }): {
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
    PATCH: (req: Request) => Promise<Response>;
    DELETE: (req: Request) => Promise<Response>;
  };
  /** GET for `<routes.preview>/route.ts` (default `/theme/preview`): starts or ends a preview on the site's origin. */
  createPreviewHandler(): { GET: (req: Request) => Promise<Response> };
}

function firstValues(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp))
    if (v !== undefined) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

/** A URI-decoded cookie value, or null when it is malformed. */
function safeDecode(v: string): string | null {
  try {
    return decodeURIComponent(v);
  } catch {
    return null;
  }
}

/** The current request: headers and the addressed origin's root (server components have no Request). */
async function currentRequest(): Promise<Request> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return new Request(`${proto}://${host}/`, { headers: h });
}

/** The origin the client addressed. */
async function currentOrigin(): Promise<string> {
  return requestOrigin(await currentRequest());
}

export function createPuckRemote(config: PuckRemoteConfig): PuckRemote {
  const core = createCore(config);
  // Per-request memo: generateMetadata and the page share one isolate pass.
  // React cache() is per request, so the memo never crosses requests (or hostnames).
  const prepare = cache(
    async (name: string, params: string, qs: string, locale: string | undefined, theme: string | null, reload: string | null) => {
      return core.prepareTemplate(name, {
        params: JSON.parse(params),
        query: Object.fromEntries(new URLSearchParams(qs)),
        locale,
        ...(theme ? { theme } : {}),
        ...(theme && reload ? { reload } : {}),
        // Forwarded to the data source only when it declares requireRequest.
        request: await currentRequest(),
      });
    },
  );
  const isHost = (origin: string) =>
    !!core.config.origins?.host.includes(origin);
  const loadTemplate: PuckRemote["loadTemplate"] = async (name, opts = {}) => {
    // Theme scripts run on public pages: never next to the admin session.
    if (isHost(await currentOrigin())) notFound();
    const qs = new URLSearchParams(
      firstValues((await opts.searchParams) ?? {}),
    ).toString();
    // Sorted keys: the same params share the memo.
    const params = JSON.stringify(
      Object.fromEntries(Object.entries(opts.params ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    );
    const jar = await cookies();
    const theme = core.previewTheme(jar.get(PREVIEW_COOKIE)?.value);
    // The live reload server of a `puck-remote dev` session, only during a preview.
    const reloadCookie = theme ? jar.get(RELOAD_COOKIE)?.value : undefined;
    const reload = reloadCookie ? safeDecode(reloadCookie) : null;
    const template = await prepare(name, params, qs, opts.locale, theme, reload);
    if (!template) notFound();
    // Theme <script> tags need the per-request CSP nonce set by createProxy.
    const nonce = (await headers()).get("x-nonce");
    return nonce ? { ...template, scriptNonce: nonce } : template;
  };
  return {
    core,
    loadTemplate,
    currentRequest,
    async loadEditor(name, opts = {}) {
      // Admin pages exist only on host origins (the editor's existence isn't revealed elsewhere).
      if (!isHost(await currentOrigin())) notFound();
      return core.editorPayload(name, { params: opts.params, theme: opts.theme });
    },
    async loadEditorPage() {
      const origins = core.config.origins;
      // Defense in depth: the proxy only routes the editor origin to this page.
      if (!origins || (await currentOrigin()) !== origins.editor) notFound();
      return { allowedParents: origins.host };
    },
    createThemeHandler() {
      return {
        GET: (req: Request) => core.handleTheme(req),
        HEAD: (req: Request) => core.handleTheme(req),
      };
    },
    createArtifactsHandler({ authorize }) {
      const handle = async (req: Request) => {
        // Defense in depth: the proxy only lets the API through on host origins.
        if (!isHost(requestOrigin(req)))
          return Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
        return core.handleArtifactsApi(req, { authorize });
      };
      return { GET: handle, POST: handle, PATCH: handle, DELETE: handle };
    },
    createPreviewHandler() {
      return { GET: async (req: Request) => core.handlePreview(req) };
    },
  };
}
