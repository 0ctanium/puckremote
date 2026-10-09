"use server";
import { normalizeSlug, PageError } from "@puck-remote/core";
import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";

// Server actions are public POST endpoints: each one checks the session itself.

export async function resolveData(params: {
  slug?: string;
  block?: string;
  props?: Record<string, unknown>;
}) {
  await requireSession({ redirect: false });
  const { slug, block, props } = params ?? {};
  const s = normalizeSlug(slug);
  if (!s || typeof block !== "string" || !props || typeof props !== "object")
    throw new Error("invalid params");
  return remote.core.resolveBlockData(s, block, props);
}

// The demo's publishing plugin: "save = write the page into a new artifact + make it current".
// Drafts, review or history would be other plugins on the same two primitives.
export async function publish(params: {
  slug?: string;
  data?: unknown;
  base?: string;
}) {
  await requireSession({ redirect: false });
  const { slug, data, base } = params ?? {};
  const s = normalizeSlug(slug);
  if (!s || typeof base !== "string") throw new Error("invalid params");
  const { artifacts } = remote.core.config;
  // Writing on an old base would undo whatever was published since (pages or theme code).
  if ((await artifacts.readPointer()) !== base)
    return { ok: false, error: "conflict" };
  try {
    const { id } = await remote.core.writePage(s, data, { base });
    await artifacts.writePointer(id);
    await (await remote.core.host()).store.reload();
    return { ok: true, id };
  } catch (e) {
    if (e instanceof PageError) return { ok: false, error: e.message };
    throw e;
  }
}
