"use client";
import { createUsePuck } from "@puckeditor/core";
import type { EditorPayload } from "@puck-remote/next";
import { PuckEditorFrame, stripResolved } from "@puck-remote/editor/frame";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { logout } from "../login/actions";
import { publish, resolveData } from "./actions";
import { rpc } from "./rpc";

const usePuck = createUsePuck();

/** What would be saved, as JSON (resolved data stripped): the "unsaved changes" baseline. */
const saved = (data: unknown) => JSON.stringify(stripResolved(data as Parameters<typeof stripResolved>[0]));

type EditedTheme = { id: string; name: string; role: string };
type PublishState = { hash: string; theme: EditedTheme; status: string; baseline: { current: string | null }; user: string };
const PublishContext = createContext<PublishState | null>(null);

/**
 * Next to Puck's own Publish button (`children`): the status, the user and Log out. Puck's
 * native header around it keeps the title and undo/redo; it all runs on the admin page.
 */
function HeaderActions({ children }: { children: ReactNode }) {
  const state = useContext(PublishContext)!;
  const data = usePuck((s) => s.appState.data);
  // The first state Puck holds (after its own normalization) is the published one.
  state.baseline.current ??= saved(data);
  const dirty = saved(data) !== state.baseline.current;
  // Leaving the page (the template switcher included) with unpublished changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <>
      <span style={{ color: "#64748b", font: "13px system-ui, sans-serif" }} data-testid="status">
        {dirty ? "Unpublished changes" : state.status} · {state.theme.name}
        {state.theme.role === "main" ? "" : ` (${state.theme.role})`} · {state.user}
      </span>
      {children}
      <form action={logout}>
        <button type="submit">Log out</button>
      </form>
    </>
  );
}

// Stable identity: Puck remounts overrides that change.
const OVERRIDES = { headerActions: HeaderActions };

/**
 * Admin UI: Puck's native layout on this page (header, rail, outline, fields), the editor frame in
 * the middle. Publish saves to `theme` (the main theme, or another one opened with ?theme=).
 */
export function ClientEditor({
  payload,
  editorUrl,
  user,
  theme,
  themeParam,
}: {
  payload: EditorPayload;
  editorUrl: string;
  user: string;
  theme: EditedTheme;
  /** The ?theme= this page was opened with (kept when switching templates). */
  themeParam: string | null;
}) {
  const { template } = payload;
  const [hash, setHash] = useState(payload.hash);
  const [status, setStatus] = useState("");
  const baseline = useRef<string | null>(null);

  async function handlePublish(data: unknown) {
    try {
      const result = await publish({ template, data, base: hash, theme: theme.id });
      if (result.ok) {
        setHash(result.hash!);
        baseline.current = saved(data);
        setStatus(`Published ${new Date().toLocaleTimeString()}`);
      } else if (result.error === "conflict") {
        setStatus("The theme changed since this editor opened: reload the page");
      } else {
        setStatus(`Publish failed (${result.error ?? "Unknown error"})`);
      }
    } catch (e) {
      setStatus(`Publish failed (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  return (
    <PublishContext.Provider value={{ hash, theme, status, baseline, user }}>
      <PuckEditorFrame
        payload={payload}
        editorUrl={editorUrl}
        rpc={rpc}
        // Trusted side: straight to the server action (it checks the session).
        resolveData={async (block, props, t) => (await resolveData({ template: t.name, params: t.params, theme: theme.id, block, props })).data}
        onPublish={handlePublish}
        onError={(m) => setStatus(`Editor: ${m}`)}
        overrides={OVERRIDES}
        // The header's template switcher opens the page a template renders (same rule as the catch-all).
        templateHref={(name) => {
          const search = new URLSearchParams({ previewPath: name === "home" ? "/" : `/${name}` });
          if (themeParam) search.set("theme", themeParam);
          return `/editor?${search}`;
        }}
      />
    </PublishContext.Provider>
  );
}
