import { remote } from "@/puck-remote.ts";
import { ClientEditor } from "./ClientEditor.tsx";

export const dynamic = "force-dynamic";

const EDITOR_URL =
  process.env.PUCK_REMOTE_EDITOR_URL ??
  `${remote.core.config.origins?.editor}/`;

export default async function AdminPage(props: {
  params: Promise<{ path?: string[] }>;
}) {
  const payload = await remote.loadEditor(props);
  return <ClientEditor payload={payload} editorUrl={EDITOR_URL} />;
}
