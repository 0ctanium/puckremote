"use client";
import { createUsePuck, Puck, useGetPuck } from "@puckeditor/core";
import type { EditorPayload } from "@puck-remote/next";
import { PuckEditorFrame, stripResolved, usePuckEditorFrame } from "@puck-remote/editor/frame";
import { useRef, useState } from "react";
import { logout } from "../login/actions";
import { publish, resolveData } from "./actions";
import { rpc } from "./rpc";

const usePuck = createUsePuck();

/** What would be saved, as JSON (resolved data stripped): the "unsaved changes" baseline. */
const saved = (data: unknown) => JSON.stringify(stripResolved(data as Parameters<typeof stripResolved>[0]));

/**
 * The admin header, inside <PuckEditorFrame>: this page's Puck holds the data and the history,
 * so undo/redo, the status and Publish all live here, out of the editor frame's reach.
 */
function AdminHeader({ slug, initialArtifact, user }: { slug: string; initialArtifact: string; user: string }) {
  const history = usePuck((s) => s.history);
  const data = usePuck((s) => s.appState.data);
  const getPuck = useGetPuck();
  const { setLeftSideBarVisible, frameReady } = usePuckEditorFrame();
  const [artifact, setArtifact] = useState(initialArtifact);
  const [leftPanel, setLeftPanel] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // The first state Puck holds (after its own normalization) is the published one.
  const baseline = useRef<string | null>(null);
  baseline.current ??= saved(data);
  const dirty = saved(data) !== baseline.current;

  async function handlePublish() {
    setBusy(true);
    try {
      const current = getPuck().appState.data;
      const result = await publish({ slug, data: current, base: artifact });
      if (result.ok) {
        setArtifact(result.id!);
        baseline.current = saved(current);
        setStatus(`Published ${new Date().toLocaleTimeString()}`);
      } else if (result.error === "conflict") {
        setStatus("The theme changed since this editor opened: reload the page");
      } else {
        setStatus(`Publish failed (${result.error ?? "Unknown error"})`);
      }
    } catch (e) {
      setStatus(`Publish failed (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #e2e8f0", font: "14px system-ui, sans-serif" }}>
      <button type="button" disabled={!frameReady} onClick={() => (setLeftSideBarVisible(!leftPanel), setLeftPanel(!leftPanel))}>
        {leftPanel ? "Hide blocks" : "Show blocks"}
      </button>
      <strong>/{slug === "home" ? "" : slug}</strong>
      <span style={{ color: "#64748b" }} data-testid="artifact-id">
        theme {artifact.slice(0, 12)} · {user}
      </span>
      <button type="button" disabled={!history.hasPast} onClick={() => history.back()}>
        Undo
      </button>
      <button type="button" disabled={!history.hasFuture} onClick={() => history.forward()}>
        Redo
      </button>
      <span style={{ flex: 1, color: "#64748b" }} data-testid="status">
        {dirty ? "Unpublished changes" : status}
      </span>
      <button type="button" disabled={!dirty || busy} onClick={handlePublish}>
        Publish
      </button>
      <form action={logout}>
        <button type="submit">Log out</button>
      </form>
    </header>
  );
}

/** Admin UI: this page's Puck (fields, history, Publish) around the editor frame (canvas, drawer, outline). */
export function ClientEditor({ payload, editorUrl, user }: { payload: EditorPayload; editorUrl: string; user: string }) {
  const { slug } = payload;
  const [error, setError] = useState("");
  return (
    <PuckEditorFrame
      payload={payload}
      editorUrl={editorUrl}
      rpc={rpc}
      // Trusted side: straight to the server action (it checks the session).
      resolveData={async (block, props) => (await resolveData({ slug, block, props })).data}
      onError={setError}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <AdminHeader slug={slug} initialArtifact={payload.artifact} user={user} />
        {error && (
          <p role="alert" style={{ margin: 0, padding: "4px 12px", color: "#b91c1c", font: "13px system-ui, sans-serif" }}>
            Editor: {error}
          </p>
        )}
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 320px" }}>
          <PuckEditorFrame.Canvas />
          <aside style={{ overflow: "auto", borderLeft: "1px solid #e2e8f0" }}>
            <Puck.Fields />
          </aside>
        </div>
      </div>
    </PuckEditorFrame>
  );
}
