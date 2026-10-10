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
  params: Promise<{ path?: string[] }>;
}) {
  const { user } = await requireSession();
  // The same path → template mapping as the public catch-all page.
  const name = normalizeSlug((await props.params).path);
  if (!name) notFound();
  const payload = await remote.loadEditor(name, { params: { slug: name } });
  return <ClientEditor payload={payload} editorUrl={EDITOR_URL} user={user} />;
}
