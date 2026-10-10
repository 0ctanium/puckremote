"use server";
import { TemplateError } from "@puck-remote/core";
import { normalizeSlug } from "@/template-name.ts";
import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";

// Server actions are public POST endpoints: each one checks the session itself.

export async function resolveData(params: {
  template?: string;
  params?: Record<string, string>;
  block?: string;
  props?: Record<string, unknown>;
}) {
  await requireSession({ redirect: false });
  const { template, params: templateParams, block, props } = params ?? {};
  const name = normalizeSlug(template);
  if (!name || typeof block !== "string" || !props || typeof props !== "object")
    throw new Error("invalid params");
  return remote.core.resolveBlockData(name, block, props, { params: templateParams });
}

/** The signed-in user's name (an RPC the editor uses for its header badge). */
export async function currentUser() {
  const { user } = await requireSession({ redirect: false });
  return user;
}

// The demo's publishing plugin: "save = write the template into a new artifact + make it current".
// Drafts, review or history would be other plugins on the same two primitives.
export async function publish(params: {
  template?: string;
  data?: unknown;
  base?: string;
}) {
  await requireSession({ redirect: false });
  const { template, data, base } = params ?? {};
  const name = normalizeSlug(template);
  if (!name || typeof base !== "string") throw new Error("invalid params");
  const { artifacts } = remote.core.config;
  // Writing on an old base would undo whatever was published since (templates or theme code).
  if ((await artifacts.readPointer()) !== base)
    return { ok: false, error: "conflict" };
  try {
    const { id } = await remote.core.writeTemplate(name, data, { base });
    await artifacts.writePointer(id);
    await (await remote.core.host()).store.reload();
    return { ok: true, id };
  } catch (e) {
    if (e instanceof TemplateError) return { ok: false, error: e.message };
    throw e;
  }
}
