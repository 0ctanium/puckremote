import type { Theme } from "@puck-remote/core";
import { requireSession } from "@/auth.ts";
import { remote } from "@/puck-remote.ts";
import { deleteTheme, publishTheme } from "./theme-actions.ts";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<Theme["role"], string> = {
  main: "Current theme",
  unpublished: "Theme library",
  development: "Development themes",
};

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

function ThemeRow({ theme }: { theme: Theme }) {
  const preview = remote.core.createPreviewUrl(theme);
  return (
    <tr style={{ borderTop: "1px solid #e2e8f0" }} data-testid={`theme-${theme.id}`}>
      <td style={{ padding: "6px 8px 6px 0" }}>
        <strong>{theme.name}</strong>
        <div style={{ color: "#64748b", fontSize: 12 }}>
          #{theme.id} · updated {when(theme.updatedAt)} · <code>{theme.hash?.slice(0, 12) ?? "no files yet"}</code>
        </div>
      </td>
      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
        <a href={theme.role === "main" ? "/editor" : `/editor?theme=${theme.id}`}>Customize</a>
        {preview && (
          <>
            {" · "}
            <a href={preview} target="_blank" rel="noreferrer">
              Preview
            </a>
          </>
        )}
      </td>
      <td style={{ padding: "6px 0 6px 8px", whiteSpace: "nowrap" }}>
        {theme.role !== "main" && (
          <form style={{ display: "inline-flex", gap: 6 }}>
            <input type="hidden" name="theme" value={theme.id} />
            <button formAction={publishTheme}>Publish</button>
            <button formAction={deleteTheme}>Delete</button>
          </form>
        )}
      </td>
    </tr>
  );
}

// admin.example.com/: the admin dashboard, a theme library like Shopify's.
export default async function AdminHome() {
  await requireSession();
  const themes = await remote.core.themes.list();
  const main = themes.find((t) => t.role === "main") ?? null;

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        maxWidth: 640,
        margin: "10vh auto",
        font: "14px system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 20, margin: 0 }}>Admin</h1>
      <p style={{ margin: 0, color: "#64748b" }} data-testid="artifact-id">
        Theme {main?.hash ? <code>{main.hash.slice(0, 12)}</code> : "none published"}
      </p>
      <p style={{ margin: 0 }}>
        <a href="/editor">Open the editor</a>
      </p>
      {(["main", "unpublished", "development"] as const).map((role) => {
        const list = themes.filter((t) => t.role === role);
        if (!list.length) return null;
        return (
          <section key={role}>
            <h2 style={{ fontSize: 15, margin: "12px 0 4px" }}>{ROLE_LABEL[role]}</h2>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {list.map((t) => (
                  <ThemeRow key={t.id} theme={t} />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
