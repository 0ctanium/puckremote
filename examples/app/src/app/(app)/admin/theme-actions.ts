"use server";
import { isThemeId } from "@puck-remote/core";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";

// Theme library actions (dashboard). Server actions are public POST endpoints: each one checks the session.

function themeId(form: FormData): string {
  const id = form.get("theme");
  if (!isThemeId(id)) throw new Error("invalid theme");
  return id;
}

/** Make a theme the main (live) one; the previous main theme becomes unpublished. */
export async function publishTheme(form: FormData) {
  await requireSession({ redirect: false });
  await remote.core.themes.publish(themeId(form));
  revalidatePath("/admin");
}

/** Delete a theme (not the main one) and its files. */
export async function deleteTheme(form: FormData) {
  await requireSession({ redirect: false });
  await remote.core.themes.delete(themeId(form));
  revalidatePath("/admin");
}
