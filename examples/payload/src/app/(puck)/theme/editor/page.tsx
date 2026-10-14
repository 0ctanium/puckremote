import { remote } from "@/puck-remote.ts";
import { EditorPage } from "./EditorPage.tsx";

export const dynamic = "force-dynamic";

// The editor page. Only reachable on origins.editor: the proxy rewrites that origin here.
export default async function Editor() {
  const { allowedParents } = await remote.loadEditorPage();
  return (
    <div style={{ height: "100vh" }}>
      <EditorPage allowedParents={allowedParents} />
    </div>
  );
}
