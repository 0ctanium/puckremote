import { isThemeId } from "@puck-remote/core";
import { normalizeSlug } from "@/template-name.ts";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";
import { ClientEditor } from "./ClientEditor.tsx";

export const dynamic = "force-dynamic";

const EDITOR_URL =
  process.env.PUCK_REMOTE_EDITOR_URL ??
  `${remote.core.config.origins?.editor}/`;

export default async function AdminPage(props: {
  searchParams: Promise<{ previewPath?: string | string[]; theme?: string | string[] }>;
}) {
  const { user } = await requireSession();
  const search = await props.searchParams;
  // ?previewPath=/blog/post opens the template that page renders (like Shopify's theme editor),
  // with the same path → template mapping as the public catch-all page; none → home.
  if (Array.isArray(search.previewPath)) notFound();
  const name = normalizeSlug(search.previewPath);
  if (!name) notFound();
  // ?theme=<id> edits another theme (e.g. a developer's) instead of the main one.
  const ref = search.theme;
  if (ref !== undefined && !isThemeId(ref)) notFound();
  const theme = ref ? await remote.core.themes.get(ref) : await remote.core.themes.main();
  if (!theme) notFound();
  const payload = await remote.loadEditor(name, { params: { slug: name }, theme: theme.id });
  return (
    <ClientEditor
      payload={payload}
      editorUrl={EDITOR_URL}
      user={user}
      theme={{ id: theme.id, name: theme.name, role: theme.role }}
      themeParam={ref ?? null}
    />
  );
}
