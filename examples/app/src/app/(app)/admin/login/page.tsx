import { redirect } from "next/navigation";
import { getSession } from "@/auth.ts";
import { login } from "./actions.ts";

export const dynamic = "force-dynamic";

const field = { display: "grid", gap: 4 } as const;

export default async function LoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect("/editor");
  const { error } = await props.searchParams;
  return (
    <form
      action={login}
      style={{ display: "grid", gap: 12, maxWidth: 280, margin: "15vh auto", font: "14px system-ui, sans-serif" }}
    >
      <h1 style={{ fontSize: 20, margin: 0 }}>Admin login</h1>
      <p style={{ margin: 0, color: "#64748b" }}>Demo credentials: admin / admin</p>
      {error && (
        <p role="alert" style={{ margin: 0, color: "#b91c1c" }}>
          Wrong username or password.
        </p>
      )}
      <label style={field}>
        Username
        <input name="username" autoComplete="username" required />
      </label>
      <label style={field}>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit">Log in</button>
    </form>
  );
}
