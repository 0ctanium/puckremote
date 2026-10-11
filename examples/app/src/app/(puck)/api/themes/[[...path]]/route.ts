import { timingSafeEqual } from "node:crypto";
import { remote } from "@/puck-remote.ts";

// The artifacts API the CLI pushes through (url `http://admin.localhost:3100/api/themes` in the
// theme's puck-remote.cli.ts). The app owns its authorization: here one deploy token for every
// action. A real app could check per-developer tokens and only let them change their own
// development themes (`action.kind`, `action.theme.role`).
function deployToken(): string | null {
  const t = process.env.PUCK_REMOTE_DEPLOY_TOKEN;
  if (t) return t;
  // Fail closed: production without a token accepts no request.
  return process.env.NODE_ENV === "production" ? null : "dev-token"; // Local development only.
}

export const { GET, POST, PATCH, DELETE } = remote.createArtifactsHandler({
  authorize(request) {
    const token = deployToken();
    const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  },
});
