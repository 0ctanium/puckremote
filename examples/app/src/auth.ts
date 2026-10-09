/**
 * Demo login for the admin pages: one hard-coded user and a stateless session cookie signed with
 * HMAC-SHA256 (a JWT without the library). The core has no authority of its own; this is the kind
 * of check a real app does with its own users and session store.
 *
 *   token = base64url(JSON { u, exp }) + "." + base64url(HMAC-SHA256(secret, payload))
 *
 * The cookie is host-only (no Domain), so only the admin hostname ever receives it: never the
 * public site (which runs theme scripts) nor the editor origin (which runs theme components).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// DEMO ONLY: replace with your user store and a password hash.
const USERNAME = "admin";
const PASSWORD = "admin";

export const SESSION_COOKIE = "admin_session";
const MAX_AGE_S = 8 * 60 * 60;
const production = process.env.NODE_ENV === "production";

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (s) return s;
  // Fail closed: a production deployment without a secret accepts no session at all.
  if (production) throw new Error("ADMIN_SESSION_SECRET is required in production");
  return "local-dev-only-session-secret"; // Local development only.
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The user's name when the credentials match, otherwise null. */
export function checkCredentials(username: string, password: string): string | null {
  // Both compared, always, so timing doesn't reveal which one was wrong.
  const userOk = same(username, USERNAME);
  const passwordOk = same(password, PASSWORD);
  return userOk && passwordOk ? USERNAME : null;
}

export async function createSession(user: string): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S })).toString("base64url");
  (await cookies()).set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The logged-in user, or null (no cookie, bad signature, expired). */
export async function getSession(): Promise<{ user: string } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const [payload, mac, ...rest] = token?.split(".") ?? [];
  if (!payload || !mac || rest.length || !same(mac, sign(payload))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof u !== "string" || typeof exp !== "number" || exp * 1000 <= Date.now()) return null;
    return { user: u };
  } catch {
    return null;
  }
}

/**
 * For admin pages: the session, or a redirect to the login page. Server actions are public POST
 * endpoints, so they check it too (`requireSession({ redirect: false })` throws instead).
 */
export async function requireSession(opts: { redirect?: boolean } = {}): Promise<{ user: string }> {
  const session = await getSession();
  if (session) return session;
  if (opts.redirect === false) throw new Error("unauthorized");
  redirect("/login");
}
