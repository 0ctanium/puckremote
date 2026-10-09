"use client";
/**
 * SPIKE (throwaway): the admin half. A second Puck whose config comes from the manifest only
 * (fields, defaults, visibleIf; renders are placeholders, never shown): no theme code runs here.
 * It holds the data, the history and the trusted UI (header, Publish); the frame shows the
 * canvas, the drawer and the outline.
 */
import { createUsePuck, Puck, useGetPuck, type Data, type PuckAction } from "@puckeditor/core";
import type { EditorPayload } from "@puck-remote/next";
import { PuckEditorFrame } from "@puck-remote/editor/frame";
import { buildEditorConfig, type ThemeModule } from "@puck-remote/editor/react";
import type { Manifest } from "@puck-remote/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { publish, resolveData } from "@/app/(app)/admin/editor/actions";
import { bytes, isSpike, SPIKE, type AdminToFrame, type ItemSelector } from "./channel";

const usePuck = createUsePuck();

type Stats = { in: number; out: number; lastOutBytes: number; maxOutBytes: number; lastRoundTripMs: number | null };

const frameWindow = () => document.querySelector<HTMLIFrameElement>('iframe[title="Page editor"]')?.contentWindow ?? null;

/** Frame edits in, the admin's state out. */
function AdminSync({ editorOrigin, onStats }: { editorOrigin: string; onStats: (s: Stats) => void }) {
  const getPuck = useGetPuck();
  const data = usePuck((s) => s.appState.data);
  const itemSelector = usePuck((s) => s.appState.ui.itemSelector) as ItemSelector;
  const ack = useRef(0);
  const lastSent = useRef<string | null>(null);
  const received = useRef<Map<number, number>>(new Map());
  const stats = useRef<Stats>({ in: 0, out: 0, lastOutBytes: 0, maxOutBytes: 0, lastRoundTripMs: null });

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const win = frameWindow();
      if (e.origin !== editorOrigin || !win || e.source !== win || !isSpike(e.data)) return;
      const m = e.data;
      const { dispatch, history } = getPuck();
      stats.current.in++;
      if (m.type === "intent") return m.intent === "undo" ? history.back() : history.forward();
      if (m.type !== "action") return;
      const action = m.action as PuckAction & { state?: { data: Data; ui: { itemSelector: ItemSelector } } };
      received.current.set(m.seq as number, performance.now());
      ack.current = m.seq as number;
      const incoming = action.type === "set" ? action.state?.ui.itemSelector : action.type === "setUi" ? (action.ui as { itemSelector?: ItemSelector }).itemSelector : undefined;
      if (action.type === "set" && action.state) {
        // Mode A: the frame's whole state.
        dispatch({ type: "setData", data: action.state.data });
        dispatch({ type: "setUi", ui: { itemSelector: action.state.ui.itemSelector } });
      } else dispatch(action);
      // SPIKE debug: what came in vs what Puck selected afterwards.
      setTimeout(() => {
        const after = getPuck().appState.ui.itemSelector;
        console.info("[spike] seq", m.seq, action.type, "in", JSON.stringify(incoming), "→ admin selected", JSON.stringify(after), "fields for", getPuck().selectedItem?.type ?? "root");
      }, 0);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editorOrigin, getPuck]);

  useEffect(() => {
    const json = JSON.stringify({ data, itemSelector });
    if (json === lastSent.current) return;
    lastSent.current = json;
    const m: AdminToFrame = { spike: SPIKE, type: "state", data, itemSelector, ack: ack.current };
    frameWindow()?.postMessage(m, editorOrigin);
    const s = stats.current;
    s.out++;
    s.lastOutBytes = bytes(m);
    s.maxOutBytes = Math.max(s.maxOutBytes, s.lastOutBytes);
    const t0 = received.current.get(ack.current);
    if (t0 !== undefined) s.lastRoundTripMs = Math.round(performance.now() - t0);
    onStats({ ...s });
  }, [data, itemSelector, editorOrigin, onStats]);
  return null;
}

/** Gives the publish handler (outside Puck's tree) the current data. */
function DataRef({ target }: { target: { current: () => Data } }) {
  const getPuck = useGetPuck();
  target.current = () => getPuck().appState.data;
  return null;
}

function Header({ slug, artifact, status, stats, mode, onPublish }: { slug: string; artifact: string; status: string; stats: Stats | null; mode: string; onPublish: () => void }) {
  const history = usePuck((s) => s.history);
  return (
    <header style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #e2e8f0", font: "13px system-ui, sans-serif" }}>
      <strong>/{slug === "home" ? "" : slug}</strong>
      <span style={{ color: "#64748b" }}>theme {artifact.slice(0, 12)} · spike mode {mode}</span>
      <button type="button" disabled={!history.hasPast} onClick={() => history.back()}>Undo</button>
      <button type="button" disabled={!history.hasFuture} onClick={() => history.forward()}>Redo</button>
      <span style={{ flex: 1, color: "#64748b" }} data-testid="spike-stats">
        {status}
        {stats && ` · in ${stats.in} / out ${stats.out} msgs · last ${stats.lastOutBytes} B (max ${stats.maxOutBytes} B)` + (stats.lastRoundTripMs !== null ? ` · round trip ${stats.lastRoundTripMs} ms` : "")}
      </span>
      <button type="button" onClick={onPublish}>Publish</button>
    </header>
  );
}

export function SpikeAdmin({ payload, editorUrl, mode }: { payload: EditorPayload; editorUrl: string; mode: string }) {
  const manifest = payload.manifest as Manifest;
  const config = useMemo(() => {
    // Placeholder renders: the admin never shows a canvas, only fields.
    const blocks = Object.fromEntries(Object.keys(manifest.blocks).map((n) => [n, { fields: {}, render: () => null }])) as unknown as ThemeModule["blocks"];
    const theme: ThemeModule = { blocks, root: manifest.root ? ({ fields: {}, render: () => null } as unknown as ThemeModule["root"]) : null };
    const ctx = { isEditing: true, locale: payload.site.locale, nonce: "", page: { slug: payload.slug }, site: { name: payload.site.name }, assetUrl: (p: string) => p, assets: { script() {}, style() {} }, head: { title() {}, meta() {} } };
    return buildEditorConfig(manifest, theme, {
      ctx: ctx as Parameters<typeof buildEditorConfig>[2]["ctx"],
      // Trusted side: straight to the server action, no frame RPC.
      resolve: async (block, props) => (await resolveData({ slug: payload.slug, block, props })).data,
    });
  }, [manifest, payload]);

  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState("");
  const [artifact, setArtifact] = useState(payload.artifact);
  const editorOrigin = new URL(editorUrl).origin;
  const getData = useRef<() => Data>(() => payload.data as unknown as Data);

  async function onPublish() {
    const r = await publish({ slug: payload.slug, data: getData.current(), base: artifact });
    if (r.ok) {
      setArtifact(r.id!);
      setStatus(`Published ${new Date().toLocaleTimeString()}`);
    } else setStatus(`Publish failed (${r.error})`);
  }

  return (
    <Puck config={config} data={payload.data as unknown as Data}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <Header slug={payload.slug} artifact={artifact} status={status} stats={stats} mode={mode} onPublish={onPublish} />
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 320px" }}>
          <PuckEditorFrame
            editorUrl={editorUrl}
            editorOrigin={editorOrigin}
            payload={payload}
            rpc={{}}
            // Spike messages share the window channel and fail the real protocol's schema.
            onError={(m) => !m.startsWith("invalid message") && setStatus(`Editor: ${m}`)}
          />
          <aside style={{ overflow: "auto", borderLeft: "1px solid #e2e8f0" }}>
            <Puck.Fields />
          </aside>
        </div>
      </div>
      <AdminSync editorOrigin={editorOrigin} onStats={setStats} />
      <DataRef target={getData} />
    </Puck>
  );
}
