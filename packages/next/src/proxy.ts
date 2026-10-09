/**
 * Next.js proxy (middleware) factory. For every request:
 *  - on the editor origin (`origins.editor`), `/` is rewritten to the app's editor page
 *    (`routes.editor`, rendering <PuckRemoteEditor>) with the editor's security headers; every
 *    other path answers 404 (only Next's `/_next/*` files pass): nothing else of the app is
 *    reachable there. On other origins, the editor route answers 404;
 *  - on host (admin) origins (`origins.host`), every path is rewritten under `routes.admin`
 *    (`/x` → `/admin/x`), except the theme route and `/_next/*`. On other origins, the admin
 *    route answers 404;
 *  - security headers: admin origins get the admin policy (no framing, only the editor origin
 *    may be framed); every other origin gets the public-site policy (CSP with a per-request nonce);
 *  - cache headers for public pages (pages using URL query params are never cacheable).
 * Imports only @puck-remote/core/edge (no isolate, no workers).
 *
 *   // src/proxy.ts
 *   export const proxy = createProxy(remoteConfig)
 *   export const config = { matcher: ['/((?!_next/|favicon\\.ico).*)'] }
 */
import {
  cspNonce,
  normalizeOrigin,
  normalizeSlug,
  pageCacheability,
  requestOrigin,
  securityHeaders,
  DEFAULT_SECURITY,
  type SecurityPolicy,
} from "@puck-remote/core/edge";
import {
  DEFAULT_ROUTES,
  type PuckRemoteConfig,
} from "@puck-remote/core/config";
import { NextResponse, type NextRequest } from "next/server";

/** Next reads the nonce from the request's CSP header (and pages from x-nonce) for its scripts. */
function withNonce(
  incoming: Headers,
  nonce: string,
  headers: Record<string, string>,
): Headers {
  const csp =
    headers["content-security-policy"] ??
    headers["content-security-policy-report-only"];
  const out = new Headers(incoming);
  out.set("x-nonce", nonce);
  if (csp) out.set("content-security-policy", csp);
  return out;
}

export function createProxy(
  config: Pick<
    PuckRemoteConfig,
    "artifacts" | "origins" | "security" | "routes"
  >,
) {
  const admin = (config.origins?.host ?? []).map(normalizeOrigin);
  const editorOrigin = config.origins
    ? normalizeOrigin(config.origins.editor)
    : undefined;
  const s = config.security ?? {};
  const policy = {
    ...DEFAULT_SECURITY,
    ...s,
    csp: { ...DEFAULT_SECURITY.csp, ...s.csp },
  } as SecurityPolicy;
  const trim = (r: string) => r.replace(/\/+$/, "");
  const editorRoute = trim(config.routes?.editor ?? DEFAULT_ROUTES.editor);
  const adminRoute = trim(config.routes?.admin ?? DEFAULT_ROUTES.admin);
  const themeRoute = trim(config.routes?.theme ?? DEFAULT_ROUTES.theme);
  const under = (pathname: string, route: string) =>
    pathname === route || pathname.startsWith(route + "/");
  const notFound = (headers: Record<string, string> = {}) =>
    new NextResponse("Not found", {
      status: 404,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  return async function proxy(req: NextRequest) {
    const origin = requestOrigin(req);
    const { pathname } = req.nextUrl;
    const dev = process.env.NODE_ENV !== "production";
    // Next's own files (page chunks, HMR): never routed, whatever the matcher.
    if (pathname.startsWith("/_next/")) return NextResponse.next();
    if (editorOrigin && origin === editorOrigin) {
      // The editor page (<PuckRemoteEditor>) at `/` only, credential-free, framed by host pages only.
      const nonce = cspNonce();
      const headers = securityHeaders("editor", {
        nonce,
        dev,
        policy,
        hostOrigins: admin,
      });
      if (pathname !== "/") return notFound(headers);
      const url = req.nextUrl.clone();
      url.pathname = editorRoute;
      const res = NextResponse.rewrite(url, {
        request: { headers: withNonce(req.headers, nonce, headers) },
      });
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }
    const surface = admin.includes(origin) ? "admin" : "site";
    const nonce = cspNonce();
    const headers = securityHeaders(surface, {
      nonce,
      dev,
      policy,
      editorOrigin,
    });
    if (surface === "admin" && !under(pathname, themeRoute)) {
      // Admin pages at the host origin's root: /x → <routes.admin>/x.
      const url = req.nextUrl.clone();
      url.pathname = pathname === "/" ? adminRoute : `${adminRoute}${pathname}`;
      const res = NextResponse.rewrite(url, {
        request: { headers: withNonce(req.headers, nonce, headers) },
      });
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }
    if (under(pathname, editorRoute)) return notFound();
    // Admin pages only answer on host origins (when origins are configured).
    if (admin.length && under(pathname, adminRoute)) return notFound(headers);
    const res = NextResponse.next({
      request: { headers: withNonce(req.headers, nonce, headers) },
    });
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    if (surface !== "site") return res;
    const slug = normalizeSlug(req.nextUrl.pathname);
    if (!slug) return res;
    const c = await pageCacheability(config, slug).catch(() => null);
    if (!c) return res;
    if (c.cacheable) res.headers.set("x-page-cacheable", "true");
    else {
      res.headers.set("cache-control", "no-store");
      res.headers.set("x-page-cacheable", "false");
      res.headers.set("x-uncacheable-blocks", c.blocks.join(","));
    }
    return res;
  };
}
