import { remote } from "@/puck-remote.ts";
import { EditorPage } from "./EditorPage.tsx";
import { SpikeFrame } from "@/spike/SpikeFrame";

export const dynamic = "force-dynamic";

// The editor page. Only reachable on origins.editor: the proxy rewrites that origin here.
export default async function Editor(props: { searchParams: Promise<{ spike?: string }> }) {
  const { allowedParents } = await remote.loadEditorPage();
  // SPIKE (throwaway): the two-Puck prototype, loaded by admin.localhost:3100/spike.
  const { spike } = await props.searchParams;
  if (spike === "state" || spike === "action")
    return <SpikeFrame allowedParents={allowedParents} mode={spike} />;
  return (
    <div style={{ height: "100vh" }}>
      <EditorPage allowedParents={allowedParents} />
    </div>
  );
}
