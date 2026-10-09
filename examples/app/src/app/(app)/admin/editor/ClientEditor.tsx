"use client";
import type { EditorPayload } from "@puck-remote/next";
import {
  PuckEditorFrame,
  type PuckEditorFrameProps,
} from "@puck-remote/editor/frame";
import { useState } from "react";
import { resolveData, publish } from "./actions";

const rpc: PuckEditorFrameProps["rpc"] = { resolveData };

/** Admin UI: the editor frame plus the host's own controls (publish lives here, not in the frame). */
export function ClientEditor({
  payload,
  editorUrl,
}: {
  payload: EditorPayload;
  editorUrl: string;
}) {
  const [data, setData] = useState<unknown>(null);
  const [artifact, setArtifact] = useState(payload.artifact);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const { slug } = payload;

  async function handlePublish() {
    setBusy(true);
    try {
      const result = await publish({ slug, data, base: artifact });

      if (result.ok) {
        setArtifact(result.id!);
        setData(null);
        setStatus(`Published ${new Date().toLocaleTimeString()}`);
      } else {
        if (result.error === "conflict") {
          setStatus(
            "The theme changed since this editor opened: reload the page",
          );
        } else {
          setStatus(`Publish failed (${result.error ?? "Unknown error"})`);
        }
      }
    } catch (e) {
      setStatus(
        `Publish failed (${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        font: "14px system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <strong>/{slug === "home" ? "" : slug}</strong>
        <span style={{ color: "#64748b" }} data-testid="artifact-id">
          theme {artifact.slice(0, 12)}
        </span>
        <span style={{ flex: 1, color: "#64748b" }}>
          {status || (data ? "Unpublished changes" : "")}
        </span>
        <button type="button" disabled={!data || busy} onClick={handlePublish}>
          Publish
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PuckEditorFrame
          editorUrl={editorUrl}
          editorOrigin={new URL(editorUrl).origin}
          payload={payload}
          rpc={rpc}
          onChange={setData}
          onError={(m) => setStatus(`Editor: ${m}`)}
        />
      </div>
    </div>
  );
}
