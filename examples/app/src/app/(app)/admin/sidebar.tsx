import { getSession } from "@/auth.ts";
import { LogoutButton } from "./login/logout-button.tsx";

// Display only: the layout also wraps /login, so no redirect here. Each page checks the session itself.
export async function User() {
  const session = await getSession();
  if (!session) return null;
  const { user } = session;

  return (
    <div>
      <p style={{ margin: 0 }}>Signed in as {user}</p>
      <LogoutButton />
    </div>
  );
}
