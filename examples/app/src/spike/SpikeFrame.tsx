"use client";
/**
 * SPIKE (throwaway): the frame half. Reuses <PuckRemoteEditor> (handshake, theme loading) and
 * replaces Puck's UI with a custom layout through overrides.puck: drawer + outline + canvas only.
 * The admin Puck holds the data; this side reports local edits and applies the admin's state.
 *
 * Mode "state" (A): reports { seq, data, itemSelector } after each local change.
 * Mode "action" (B): reports Puck's own actions. Needs onAction passed through <PuckRemoteEditor>; that
 * temporary change was reverted (D-0336), so on this branch mode B sends no frame edits.
 */
import "@puckeditor/core/no-external.css";
import { createUsePuck, Puck, useGetPuck, type Config, type Data, type PuckAction } from "@puckeditor/core";
import { PuckRemoteEditor } from "@puck-remote/editor/react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { DATA_ACTIONS, isSpike, SPIKE, type FrameToAdmin, type ItemSelector } from "./channel";

const usePuck = createUsePuck();

type Mode = "state" | "action";
type Ctx = { allowedParents: string[]; mode: Mode; seq: { current: number }; applied: { current: string | null } };
const SpikeCtx = createContext<Ctx | null>(null);

type Outgoing = FrameToAdmin extends infer T ? (T extends unknown ? Omit<T, "spike"> : never) : never;

function post(ctx: Ctx, m: Outgoing) {
  // Only the real parent receives it: postMessage drops mismatched target origins.
  for (const origin of ctx.allowedParents) window.parent.postMessage({ spike: SPIKE, ...m }, origin);
}

/** The admin's state and intents in; local state (mode A) out. */
function FrameSync() {
  const ctx = useContext(SpikeCtx)!;
  const getPuck = useGetPuck();
  const data = usePuck((s) => s.appState.data);
  const itemSelector = usePuck((s) => s.appState.ui.itemSelector) as ItemSelector;

  // Mode A: every local change goes out; states we just applied from the admin don't.
  useEffect(() => {
    if (ctx.mode !== "state") return;
    const json = JSON.stringify({ data, itemSelector });
    if (json === ctx.applied.current) return;
    ctx.seq.current++;
    post(ctx, { type: "action", seq: ctx.seq.current, action: { type: "set", state: { data, ui: { itemSelector } } } as PuckAction });
  }, [ctx, data, itemSelector]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent || !ctx.allowedParents.includes(e.origin) || !isSpike(e.data)) return;
      const m = e.data;
      if (m.type !== "state") return;
      // Our own edits still in flight: the admin hasn't seen them, its state is older than ours.
      if ((m.ack as number) < ctx.seq.current) return;
      const next = { data: m.data as Data, itemSelector: (m.itemSelector ?? null) as ItemSelector };
      const json = JSON.stringify(next);
      const { appState, dispatch } = getPuck();
      if (json === JSON.stringify({ data: appState.data, itemSelector: appState.ui.itemSelector })) return;
      ctx.applied.current = json;
      dispatch({ type: "setData", data: next.data, recordHistory: false });
      dispatch({ type: "setUi", ui: { itemSelector: next.itemSelector }, recordHistory: false });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ctx, getPuck]);

  // Undo/redo belong to the admin's history: forward the shortcut instead of running Puck's own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      post(ctx, { type: "intent", intent: e.shiftKey ? "redo" : "undo" });
    };
    const docs = new Set<Document>([document]);
    const attach = () => {
      const canvas = document.querySelector<HTMLIFrameElement>("#preview-frame")?.contentDocument;
      if (canvas && !docs.has(canvas)) {
        docs.add(canvas);
        canvas.addEventListener("keydown", onKey, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    const t = setInterval(attach, 500);
    return () => {
      clearInterval(t);
      for (const d of docs) d.removeEventListener("keydown", onKey, true);
    };
  }, [ctx]);
  return null;
}

/** Replaces Puck's whole UI: drawer + outline on the left, the canvas, and the sync. */
function SpikeLayout() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", height: "100vh", font: "13px system-ui, sans-serif" }}>
      <aside style={{ overflow: "auto", borderRight: "1px solid #e2e8f0", padding: 8 }}>
        <h4 style={{ margin: "4px 0 8px" }}>Blocks</h4>
        <Puck.Components />
        <h4 style={{ margin: "16px 0 8px" }}>Outline</h4>
        <Puck.Outline />
      </aside>
      <div style={{ minWidth: 0, height: "100%" }}>
        <Puck.Preview />
      </div>
      <FrameSync />
    </div>
  );
}

/** The admin runs resolveData (and holds __data); the frame only renders what it receives. */
function withoutResolveData(config: Config): Config {
  const components = Object.fromEntries(Object.entries(config.components).map(([k, c]) => [k, { ...c, resolveData: undefined }]));
  return { ...config, components, root: config.root ? { ...config.root, resolveData: undefined } : undefined };
}

export function SpikeFrame({ allowedParents, mode }: { allowedParents: string[]; mode: Mode }) {
  const ctx = useMemo<Ctx>(() => ({ allowedParents, mode, seq: { current: 0 }, applied: { current: null } }), [allowedParents, mode]);
  const overrides = useMemo(() => ({ puck: SpikeLayout }), []);
  // Mode B: forward Puck's data actions and selections as they happen.
  const onAction = useMemo(
    () =>
      mode === "action"
        ? (action: PuckAction) => {
            if (action.recordHistory === false) return; // states applied from the admin
            if (DATA_ACTIONS.has(action.type)) {
              ctx.seq.current++;
              post(ctx, { type: "action", seq: ctx.seq.current, action });
            } else if (action.type === "setUi" && typeof action.ui === "object" && "itemSelector" in action.ui) {
              ctx.seq.current++;
              post(ctx, { type: "action", seq: ctx.seq.current, action: { type: "setUi", ui: { itemSelector: action.ui.itemSelector } } });
            }
          }
        : undefined,
    [ctx, mode],
  );
  return (
    <SpikeCtx.Provider value={ctx}>
      <PuckRemoteEditor
        allowedParents={allowedParents}
        overrides={overrides}
        transformConfig={withoutResolveData}
        fallback={<p style={{ padding: 16 }}>Spike: waiting for the admin page…</p>}
        {...(onAction ? ({ onAction } as object) : {})}
      />
    </SpikeCtx.Provider>
  );
}
