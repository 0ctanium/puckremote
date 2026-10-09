/**
 * Next.js App Router bindings. All logic lives in @puck-remote/core; these only adapt Next's
 * params/searchParams/notFound/route-handler conventions.
 *
 *   // src/puck-remote.ts
 *   export const remote = createPuckRemote(config)
 *   // app/[[...path]]/page.tsx            → remote.loadPage(props) + <PuckRemotePage page={page} />
 *   // app/admin/[[...path]]/page.tsx      → <PuckEditorFrame payload={await remote.loadEditor(props)} … />
 *   // app/editor/[[...path]]/page.tsx     → <PuckRemoteEditor {...await remote.loadEditorPage()} … /> (on origins.editor)
 *   // app/theme/[[...path]]/route.ts      → export const { GET, HEAD } = remote.createThemeHandler()
 */
import {
  createCore,
  normalizeSlug,
  type EditorPayload,
  type PageContext,
  type PuckRemoteConfig,
  type PuckRemoteCore,
  type PreparedPage,
} from "@puck-remote/core";
import { requestOrigin } from "@puck-remote/core/edge";
import { pageMetadata } from "@puck-remote/core/react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

export { PuckRemotePage, pageMetadata } from "@puck-remote/core/react";
export type { EditorPayload, PageContext, PuckRemoteConfig, PreparedPage };

type Params = Promise<{ path?: string[] }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export interface PageProps {
  params: Params;
  searchParams?: SearchParams;
}

export interface PuckRemote {
  core: PuckRemoteCore;
  /** Resolve data and render all blocks in the isolate. Calls notFound() for unknown pages and on host origins. */
  loadPage(props: PageProps, context?: PageContext): Promise<PreparedPage>;
  generateMetadata(props: PageProps): Promise<Metadata>;
  /** The editor payload for an admin page. Calls notFound() outside origins.host. */
  loadEditor(props: { params: Params }): Promise<EditorPayload>;
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
}

async function slugOf(params: Params): Promise<string> {
  const slug = normalizeSlug((await params).path);
  if (!slug) notFound();
  return slug;
}

function firstValues(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp))
    if (v !== undefined) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

/** The origin the client addressed (server components have no Request). */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return requestOrigin(new Request(`${proto}://${host}/`, { headers: h }));
}

export function createPuckRemote(config: PuckRemoteConfig): PuckRemote {
  const core = createCore(config);
  // Per-request memo: generateMetadata and the page share one isolate pass.
  // React cache() is per request, so the memo never crosses requests (or hostnames).
  const prepare = cache(
    async (slug: string, qs: string, locale: string | undefined) => {
      return core.preparePage(
        slug,
        Object.fromEntries(new URLSearchParams(qs)),
        { locale },
      );
    },
  );
  const isHost = (origin: string) =>
    !!core.config.origins?.host.includes(origin);
  const loadPage: PuckRemote["loadPage"] = async (
    { params, searchParams },
    context = {},
  ) => {
    const slug = await slugOf(params);
    // Theme scripts run on public pages: never next to the admin session.
    if (isHost(await currentOrigin())) notFound();
    const qs = new URLSearchParams(
      firstValues((await searchParams) ?? {}),
    ).toString();
    const page = await prepare(slug, qs, context.locale);
    if (!page) notFound();
    // Theme <script> tags need the per-request CSP nonce set by createProxy.
    const nonce = (await headers()).get("x-nonce");
    return nonce ? { ...page, scriptNonce: nonce } : page;
  };
  return {
    core,
    loadPage,
    async generateMetadata(props) {
      return pageMetadata(await loadPage(props));
    },
    async loadEditor({ params }) {
      const slug = await slugOf(params);
      // Admin pages exist only on host origins (the editor's existence isn't revealed elsewhere).
      if (!isHost(await currentOrigin())) notFound();
      return core.editorPayload(slug);
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
  };
}
