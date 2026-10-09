"use client";
import "@puckeditor/core/no-external.css";
import { PuckRemoteEditor } from "@puck-remote/editor/react";

/**
 * The editor frame: canvas, drawer and outline, with the theme's components. The page data,
 * the history, the fields and Publish are the admin page's (<PuckEditorFrame>).
 */
export function EditorPage({ allowedParents }: { allowedParents: string[] }) {
  return <PuckRemoteEditor allowedParents={allowedParents} fallback={<p style={{ padding: 16 }}>Waiting for the admin page…</p>} />;
}
