import { remote } from "@/puck-remote.ts";

// localhost:3100/theme/preview?token=… previews a theme (`puck-remote dev` and `share` print the
// link); ?exit goes back to the live site.
export const { GET } = remote.createPreviewHandler();
