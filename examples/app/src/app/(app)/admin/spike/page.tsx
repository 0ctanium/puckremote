import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";
import { SpikeAdmin } from "@/spike/SpikeAdmin";

export const dynamic = "force-dynamic";

// SPIKE (throwaway): admin.localhost:3100/spike[?mode=action]
export default async function SpikePage(props: { searchParams: Promise<{ mode?: string }> }) {
  await requireSession();
  const mode = (await props.searchParams).mode === "action" ? "action" : "state";
  const payload = await remote.loadEditor({ params: Promise.resolve({}) });
  const editorUrl = `${remote.core.config.origins?.editor}/?spike=${mode}`;
  return <SpikeAdmin payload={payload} editorUrl={editorUrl} mode={mode} />;
}
