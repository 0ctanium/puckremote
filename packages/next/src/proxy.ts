/**
 * Next.js proxy (middleware) factory. For every request:
 *  - on the editor origin (`origins.editor`), `/` is rewritten to the app's editor page
 *    (`routes.editor`, rendering <PuckRemoteEditor>) with the editor's security headers; every
 *    other path answers 404 (only Next's `/_next/*` files pass): nothing else of the app is
 *    reachable there. On other origins, the editor route answers 404;
 *  - on host (admin) origins (`origins.host`), every path is rewritten under `routes.admin`
 *    (`/x` → `/admin/x`), except the theme route and `/_next/*`; old links already under it
 *    (`/admin/x`) redirect to `/x`. On other origins, the admin route answers 404;
 *  - security headers: admin origins get the admin policy (no framing, only the editor origin
 *    may be framed); every other origin gets the public-site policy (CSP with a per-request nonce);
 *  - cache headers for public pages, when `options.template` maps a path to its template
 *    (templates using URL query params are never cacheable).
 * Imports only @puck-remote/core/edge (no isolate, no workers).
 *
 *   // src/proxy.ts
 *   export const proxy = createProxy(remoteConfig, { template: (path) => ({ name: … }) })
 *   export const config = { matcher: ['/((?!_next/|favicon\\.ico).*)'] }
 */
import {
  cspNonce,
  normalizeOrigin,
  templateCacheability,
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

export interface ProxyOptions {
  /**
   * The template a public path renders, for its cache headers (`x-template-cacheable`, and
   * `no-store` when it uses URL query params). Without it no cache headers are set.
   */
  template?: (pathname: string) => { name: string } | null;
}

export function createProxy(
  config: Pick<
    PuckRemoteConfig,
    "artifacts" | "origins" | "security" | "routes"
  >,
  options: ProxyOptions = {},
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
    if (surface === "admin" && under(pathname, adminRoute)) {
      // Old links (/admin/x) → /x. Temporary, so browsers don't cache it for good.
      // Built on the addressed origin: behind a proxy, nextUrl may carry the server's own host.
      const url = new URL(
        (pathname.slice(adminRoute.length) || "/") + req.nextUrl.search,
        origin,
      );
      const res = NextResponse.redirect(url, 307);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      res.headers.set("cache-control", "no-store");
      return res;
    }
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
    const template = options.template?.(req.nextUrl.pathname);
    if (!template) return res;
    const c = await templateCacheability(config, template.name).catch(() => null);
    if (!c) return res;
    if (c.cacheable) res.headers.set("x-template-cacheable", "true");
    else {
      res.headers.set("cache-control", "no-store");
      res.headers.set("x-template-cacheable", "false");
      res.headers.set("x-uncacheable-blocks", c.blocks.join(","));
    }
    return res;
  };
}
