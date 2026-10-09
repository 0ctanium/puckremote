import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";
import { logout } from "./login/actions.ts";

export const dynamic = "force-dynamic";

// admin.example.com/: the admin dashboard.
export default async function AdminHome() {
  const { user } = await requireSession();
  const current = await remote.core.config.artifacts.readPointer();
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 480, margin: "10vh auto", font: "14px system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Admin</h1>
      <p style={{ margin: 0 }}>Signed in as {user}</p>
      <p style={{ margin: 0, color: "#64748b" }} data-testid="artifact-id">
        Theme {current ? <code>{current.slice(0, 12)}</code> : "none published"}
      </p>
      <p style={{ margin: 0 }}>
        <a href="/editor">Open the editor</a>
      </p>
      <form action={logout}>
        <button type="submit">Log out</button>
      </form>
    </div>
  );
}
