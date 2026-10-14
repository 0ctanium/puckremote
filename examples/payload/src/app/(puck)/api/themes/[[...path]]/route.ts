import { payloadAuthorize } from "@puck-remote/payload/auth";
import { payload } from "@/payload.ts";
import { remote } from "@/puck-remote.ts";

// The artifacts API the CLI pushes through (examples/theme/puck-remote.payload.cli.ts), authorized
// by Payload: a user of the admin collection, by session cookie or API key.
export const { GET, POST, PATCH, DELETE } = remote.createArtifactsHandler({
  authorize: payloadAuthorize({ payload }),
});
