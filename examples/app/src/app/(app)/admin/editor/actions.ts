"use server";
import { isThemeId, TemplateError, ThemeError } from "@puck-remote/core";
import { normalizeSlug } from "@/template-name.ts";
import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";

// Server actions are public POST endpoints: each one checks the session itself.

export async function resolveData(params: {
  template?: string;
  params?: Record<string, string>;
  theme?: string;
  block?: string;
  props?: Record<string, unknown>;
}) {
  await requireSession({ redirect: false });
  const { template, params: templateParams, theme, block, props } = params ?? {};
  const name = normalizeSlug(template);
  if (!name || !isThemeId(theme) || typeof block !== "string" || !props || typeof props !== "object")
    throw new Error("invalid params");
  // The request carries the admin session: the data source shows drafts to signed-in admins.
  return remote.core.resolveBlockData(name, block, props, { params: templateParams, theme, request: await remote.currentRequest() });
}

/** The signed-in user's name (an RPC the editor uses for its header badge). */
export async function currentUser() {
  const { user } = await requireSession({ redirect: false });
  return user;
}

// The demo's publishing plugin: "save = write the template into the theme the editor was opened on"
// (the main theme, or another one with ?theme=).
// Drafts, review or history would be other plugins on the same two primitives.
export async function publish(params: {
  template?: string;
  data?: unknown;
  /** The theme's hash when the editor opened (or after the last save). */
  base?: string;
  theme?: string;
}) {
  await requireSession({ redirect: false });
  const { template, data, base, theme } = params ?? {};
  const name = normalizeSlug(template);
  if (!name || typeof base !== "string" || !isThemeId(theme)) throw new Error("invalid params");
  try {
    // `expect`: saving on an old version would undo whatever was pushed since (templates or theme
    // code, e.g. a `puck-remote dev` push). The main theme reloads by itself.
    const { hash } = await remote.core.writeTemplate(name, data, { theme, expect: base });
    return { ok: true, hash };
  } catch (e) {
    if (e instanceof ThemeError && e.status === 409) return { ok: false, error: "conflict" };
    if (e instanceof TemplateError) return { ok: false, error: e.message };
    throw e;
  }
}
