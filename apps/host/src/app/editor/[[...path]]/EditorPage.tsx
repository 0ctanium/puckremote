"use client";
import "@puckeditor/core/no-external.css";
import { PuckRemoteEditor, useEditor } from "@puck-remote/editor/react";

/** A customization example: a header badge showing which page and theme are being edited. */
function HeaderBadge() {
  const { payload } = useEditor();
  return (
    <span style={{ fontSize: 12, color: "#64748b" }}>
      editing /{payload.slug === "home" ? "" : payload.slug} · theme{" "}
      {payload.artifact.slice(0, 12)}
    </span>
  );
}

// Stable identity: Puck remounts overrides that change.
const OVERRIDES = { headerActions: HeaderBadge };

export function EditorPage({ allowedParents }: { allowedParents: string[] }) {
  return (
    <PuckRemoteEditor
      allowedParents={allowedParents}
      overrides={OVERRIDES}
      fallback={<p style={{ padding: 16 }}>Waiting for the admin page…</p>}
    />
  );
}
