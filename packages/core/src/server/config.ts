import type { AnyDataSource, ArtifactStore } from "@puck-remote/sdk/host";
import { fieldsSchema, type FieldSpec } from "./manifest-schema.ts";
import type { RendererFactory } from "./runtime/types.ts";
import {
  DEFAULT_SECURITY,
  normalizeOrigin,
  type SecurityPolicy,
} from "./surface.ts";

export interface SecretDef {
  value: string;
  /** Origins this secret may be sent to. Anything else is rejected. */
  origins: string[];
}

/** Fully resolved configuration used by the core. */
export interface HostConfig {
  id: string;
  routes: Routes;
  /** Theme artifacts (code and templates) and the theme list (trusted host plugin chosen by the app). */
  artifacts: ArtifactStore;
  /** How often to poll the theme list when the store has no change feed. */
  artifactPollMs: number;
  source: AnyDataSource;
  /** Where theme code runs. null → the host's default (see host.ts). */
  renderer: RendererFactory | null;
  /** CSP and related policy for public pages (see surface.ts securityHeaders). */
  security: SecurityPolicy;
  /**
   * Where the editor runs: the host's admin pages (which embed the editor and own the session)
   * and the static editor app (credential-free). null = editor not configured.
   */
  origins: EditorOrigins | null;
  site: { name: string; locale: string };
  isolate: {
    memoryLimitMb: number;
    /** Per-call CPU timeout enforced by isolated-vm. */
    callTimeoutMs: number;
    /** Host-side wall-clock watchdog; on overrun the isolate is disposed. */
    watchdogMs: number;
    maxInputBytes: number;
    maxOutputBytes: number;
  };
  budget: {
    maxQueries: number;
    maxResponseBytes: number;
    maxWallMs: number;
  };
  http: {
    /** Origins blocks/adapters may reach. Must also match the block's declared origin. */
    allowedOrigins: string[];
    /**
     * Origins exempt from https + public-IP rules. Dev/test only (the mock API on localhost).
     * Never set in production.
     */
    insecureDevOrigins: string[];
    timeoutMs: number;
    maxResponseBytes: number;
    maxRedirects: number;
  };
  secrets: Record<string, SecretDef>;
  /** The app's root fields, merged with the theme's (the app's win on a name collision). */
  root: AppRoot;
  /** Several themes (Shopify-like) or just the main one. */
  themes: {
    /** false: only a main theme exists (no unpublished or development themes, no previews). */
    multiple: boolean;
    /** Development themes not updated for this many days are deleted. */
    devExpiryDays: number;
  };
  /** Runtimes kept for non-main artifacts (previewed themes), besides the main one. */
  previewRuntimes: {
    /** At most this many; the least recently used is disposed first. */
    max: number;
    /** Disposed after this long without a request. */
    idleMs: number;
  };
  /** Signed preview links for non-main themes on public pages. null = preview disabled. */
  preview: PreviewConfig | null;
  /** Limits of the artifacts API (uploads from the CLI). */
  api: {
    /** Compressed package size. */
    maxPackageBytes: number;
    /** Total size of the unpacked files. */
    maxUnpackedBytes: number;
    maxFiles: number;
  };
}

export interface PreviewConfig {
  /** HMAC key for preview tokens. Keep it secret; rotating it ends every preview. */
  secret: string;
  /** Lifetime of a preview link and its cookie. */
  ttlSeconds: number;
}

export interface AppRoot {
  fields: Record<string, FieldSpec>;
  defaultProps: Record<string, unknown>;
}

export interface EditorOrigins {
  /** Origins of the host pages that embed the editor (<PuckEditorFrame>). */
  host: string[];
  /** Origin of the static editor app loaded in the iframe. */
  editor: string;
  /** Canonical public origin of the site, used to build preview links. */
  site?: string;
}

export interface Routes {
  /** Prefix of the catch-all theme route (assets and the editor's browser bundle). */
  theme: string;
  /** Prefix of the app's editor route, when the app serves the editor itself (only on origins.editor). */
  editor: string;
  /** Prefix of the app's admin pages; host origins serve them at their root (`/x` → `<admin>/x`). */
  admin: string;
  /** Prefix of the artifacts API route (host origins only; not moved under `admin`). */
  api: string;
  /** Path of the preview route on public origins (sets or clears the preview cookie). */
  preview: string;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};

/** What an app provides. Everything except paths and plugins has a default. */
type Plugins =
  | "artifacts"
  | "source"
  | "secrets"
  | "renderer"
  | "security"
  | "origins"
  | "root"
  | "preview";

/** What an app provides. Everything except the storage plugins has a default. */
export interface PuckRemoteConfig extends DeepPartial<
  Omit<HostConfig, Plugins>
> {
  /** Distinguishes runtimes if one process hosts several sites. Default 'default'. */
  id?: string;
  artifacts: ArtifactStore;
  source: AnyDataSource;
  /** Where theme code runs: workerPoolRenderer() (default) or inProcessRenderer(). */
  renderer?: RendererFactory | null;
  /** CSP and related headers for public pages; see DEFAULT_SECURITY. */
  security?: Partial<Omit<SecurityPolicy, "csp">> & {
    csp?: Partial<SecurityPolicy["csp"]>;
  };
  secrets?: Record<string, SecretDef>;
  /** Host (admin) and editor origins, e.g. { host: ['https://admin.example.com'], editor: 'https://editor.example.net' }. */
  origins?: EditorOrigins | null;
  /**
   * Root fields of every template, owned by the app (e.g. SEO title and description), merged with
   * the theme's root fields. Type them for the theme with `Register.rootProps` (`RootPropsOf`).
   */
  root?: { fields: Record<string, FieldSpec>; defaultProps?: Record<string, unknown> };
  /** Enables preview links for non-live heads on public pages. */
  preview?: { secret: string; ttlSeconds?: number } | null;
}

export class ConfigError extends Error {}

/** Typed identity: use in the app's puck-remote.config.ts. Safe to import from proxy/edge code. */
export function defineConfig<C extends PuckRemoteConfig>(config: C): C {
  return config;
}

export const DEFAULT_ROUTES: Routes = {
  theme: "/cdn",
  editor: "/theme/editor",
  admin: "/admin",
  api: "/api/themes",
  preview: "/theme/preview",
};

function resolveSecurity(
  input: Pick<PuckRemoteConfig, "security">,
): SecurityPolicy {
  const s = input.security ?? {};
  return {
    ...DEFAULT_SECURITY,
    ...s,
    csp: { ...DEFAULT_SECURITY.csp, ...s.csp },
  } as SecurityPolicy;
}

export function resolveOrigins(
  input: PuckRemoteConfig["origins"],
): EditorOrigins | null {
  if (!input) return null;
  const admin = input.host.map(normalizeOrigin);
  const editor = normalizeOrigin(input.editor);
  if (!admin.length)
    throw new ConfigError(
      "puck-remote: origins.host must list at least one origin",
    );
  if (admin.includes(editor)) {
    throw new ConfigError(
      `puck-remote: ${editor} is both a host and the editor origin. The editor runs theme code; it must live on its own origin, without the admin's session.`,
    );
  }
  return input.site ? { host: admin, editor, site: normalizeOrigin(input.site) } : { host: admin, editor };
}

function resolvePreview(input: PuckRemoteConfig["preview"]): PreviewConfig | null {
  if (!input) return null;
  if (typeof input.secret !== "string" || !input.secret)
    throw new ConfigError("puck-remote: preview.secret must be a non-empty string");
  return { secret: input.secret, ttlSeconds: input.ttlSeconds ?? 3600 };
}

function resolveRoot(input: PuckRemoteConfig["root"]): AppRoot {
  const parsed = fieldsSchema.safeParse(input?.fields ?? {});
  if (!parsed.success)
    throw new ConfigError(`puck-remote: root.fields is invalid: ${parsed.error.message}`);
  return { fields: parsed.data, defaultProps: { ...input?.defaultProps } };
}

export function resolveConfig(input: PuckRemoteConfig): HostConfig {
  return {
    root: resolveRoot(input.root),
    origins: resolveOrigins(input.origins),
    id: input.id ?? "default",
    artifacts: input.artifacts,
    artifactPollMs: input.artifactPollMs ?? 2000,
    source: input.source,
    renderer: input.renderer ?? null,
    security: resolveSecurity(input),
    routes: { ...DEFAULT_ROUTES, ...input.routes },
    site: { name: "Site", locale: "en", ...input.site },
    isolate: {
      memoryLimitMb: 64,
      callTimeoutMs: 200,
      watchdogMs: 1000,
      maxInputBytes: 1024 * 1024,
      maxOutputBytes: 512 * 1024,
      ...input.isolate,
    },
    budget: {
      maxQueries: 20,
      maxResponseBytes: 2 * 1024 * 1024,
      maxWallMs: 3000,
      ...input.budget,
    },
    http: {
      allowedOrigins: [],
      insecureDevOrigins: [],
      timeoutMs: 2000,
      maxResponseBytes: 512 * 1024,
      maxRedirects: 3,
      ...input.http,
    },
    secrets: input.secrets ?? {},
    themes: { multiple: false, devExpiryDays: 7, ...input.themes },
    previewRuntimes: { max: 3, idleMs: 10 * 60_000, ...input.previewRuntimes },
    preview: resolvePreview(input.preview),
    api: {
      maxPackageBytes: 50 * 1024 * 1024,
      maxUnpackedBytes: 200 * 1024 * 1024,
      maxFiles: 5000,
      ...input.api,
    },
  };
}
