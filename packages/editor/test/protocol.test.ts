/** The postMessage protocol and both sides' checks (origin, source, version, size, rate). */
import { describe, expect, it, vi } from "vitest";
import { createFrameSync, initProblem, toFrameAction } from "../src/react.tsx";
import { placeholderTheme, stripResolved, withoutResolveData } from "../src/config.tsx";
import { frameProblem, frameUi, hostMessageHandler } from "../src/frame.tsx";
import {
  editorToHostSchema,
  hostToEditorSchema,
  LIMITS,
  measure,
  PROTOCOL_VERSION,
  rateLimiter,
  type EditorPayload,
  type FrameAction,
  type HostToEditor,
} from "../src/protocol.ts";

const ADMIN = "https://admin.example.com";
const EDITOR = "https://editor.example.net";
const payload: EditorPayload = {
  artifact: "a".repeat(64),
  slug: "home",
  manifest: { blocks: { hero: {}, card: {} }, root: null, categories: {} } as never,
  data: { root: { props: {} }, content: [] },
  bundleUrl: `${ADMIN}/cdn/bundle.browser.js?v=${"a".repeat(12)}`,
  assetBase: `${ADMIN}/cdn/assets/`,
  origins: { host: [ADMIN], editor: EDITOR },
  site: { name: "S", locale: "en" },
};

function harness(rpc: Record<string, (p: unknown) => unknown> = {}, permissions: Record<string, boolean> = {}) {
  const win = {};
  const sent: HostToEditor[] = [];
  const actions: [number, FrameAction | null][] = [];
  const intents: string[] = [];
  const errors: string[] = [];
  let ready = 0;
  let t = 0;
  const handle = hostMessageHandler({
    editorOrigin: EDITOR,
    source: () => win,
    post: (m) => sent.push(m),
    init: () => ({ payload, options: { flags: { beta: true }, permissions } }),
    rpc: () => rpc,
    blocks: () => ["hero", "card"],
    onAction: (seq, a) => actions.push([seq, a]),
    onIntent: (i) => intents.push(i),
    onReady: () => ready++,
    onError: (m) => errors.push(m),
    now: () => t,
  });
  const from = (data: unknown, o: { origin?: string; source?: unknown } = {}) =>
    handle({
      origin: o.origin ?? EDITOR,
      source: "source" in o ? o.source : win,
      data,
    });
  return { win, sent, actions, intents, errors, from, ready: () => ready, tick: (ms: number) => (t += ms) };
}

describe("message schemas", () => {
  it("accept the six typed messages with the current version, nothing else", () => {
    expect(editorToHostSchema.safeParse({ v: PROTOCOL_VERSION, type: "ready" }).success).toBe(
      true,
    );
    expect(
      editorToHostSchema.safeParse({
        v: PROTOCOL_VERSION,
        type: "rpc",
        id: 1,
        method: "resolveData",
        params: {},
      }).success,
    ).toBe(true);
    expect(
      hostToEditorSchema.safeParse({ v: PROTOCOL_VERSION, type: "init", payload, options: {} })
        .success,
    ).toBe(true);
    expect(
      hostToEditorSchema.safeParse({
        v: PROTOCOL_VERSION,
        type: "rpc:result",
        id: 1,
        ok: false,
        error: "x",
      }).success,
    ).toBe(true);
    expect(editorToHostSchema.safeParse({ v: 1, type: "ready" }).success).toBe(
      false,
    );
    expect(
      editorToHostSchema.safeParse({ v: PROTOCOL_VERSION, type: "publish" }).success,
    ).toBe(false);
    expect(
      editorToHostSchema.safeParse({ v: PROTOCOL_VERSION, type: "ready", extra: 1 }).success,
    ).toBe(false);
    expect(
      editorToHostSchema.safeParse({
        v: PROTOCOL_VERSION,
        type: "rpc",
        id: 1,
        method: "a b",
        params: {},
      }).success,
    ).toBe(false);
    // Options are JSON only.
    expect(
      hostToEditorSchema.safeParse({
        v: PROTOCOL_VERSION,
        type: "init",
        payload,
        options: { flags: { x: "no" } },
      }).success,
    ).toBe(false);
  });

  it("measure counts JSON bytes and Blob bytes, and rejects non-JSON values", () => {
    expect(measure({ a: "é" })).toEqual({ jsonBytes: 10, blobBytes: 0 });
    expect(measure({ file: new Blob(["abcd"]) })).toEqual({
      jsonBytes: 13,
      blobBytes: 4,
    });
    expect(measure({ f: () => 1 })).toBeNull();
    expect(measure(new Map())).toBeNull();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(measure(cyc)).toBeNull();
  });

  it("rateLimiter allows a burst, then refills over time", () => {
    let t = 0;
    const allow = rateLimiter(3, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    t += 400;
    expect(allow()).toBe(true);
    expect(allow()).toBe(false);
  });
});

describe("host side (<PuckEditorFrame>)", () => {
  it("refuses to load outside an admin origin or with mismatched editor origins", () => {
    const p = { editorUrl: `${EDITOR}/`, editorOrigin: EDITOR, payload };
    expect(frameProblem(p, ADMIN)).toBeNull();
    expect(frameProblem(p, "https://www.example.com")).toMatch(
      /not on a configured admin origin/,
    );
    expect(
      frameProblem({ ...p, editorUrl: "https://other.example.net/" }, ADMIN),
    ).toMatch(/not on editorOrigin/);
    expect(
      frameProblem(
        {
          ...p,
          editorUrl: "https://other.example.net/",
          editorOrigin: "https://other.example.net",
        },
        ADMIN,
      ),
    ).toMatch(/does not match/);
  });

  it("answers ready with init; ignores other origins and other windows", async () => {
    const h = harness();
    await h.from({ v: PROTOCOL_VERSION, type: "ready" }, { origin: "https://evil.test" });
    await h.from({ v: PROTOCOL_VERSION, type: "ready" }, { source: {} });
    await h.from({ v: PROTOCOL_VERSION, type: "ready" }, { source: null });
    expect(h.sent).toEqual([]);
    await h.from({ v: PROTOCOL_VERSION, type: "ready" });
    expect(h.sent).toEqual([
      {
        v: PROTOCOL_VERSION,
        type: "init",
        payload,
        options: { flags: { beta: true }, permissions: {} },
      },
    ]);
    // Then this side sends its current state.
    expect(h.ready()).toBe(1);
  });

  it("replays validated actions; refuses (and acknowledges) anything else", async () => {
    const h = harness({}, { delete: false });
    const action = (seq: number, a: unknown) => h.from({ v: PROTOCOL_VERSION, type: "action", seq, action: a });
    await action(1, { type: "insert", componentType: "card", destinationIndex: 0, destinationZone: "root:default-zone", id: "c1", extra: "dropped" });
    await action(2, { type: "move", sourceIndex: 0, sourceZone: "root:default-zone", destinationIndex: 1, destinationZone: "hero-1:content" });
    await action(3, { type: "setUi", ui: { itemSelector: { index: 0, zone: "root:default-zone" }, leftSideBarVisible: false } });
    await action(4, { type: "replace", destinationIndex: 0, destinationZone: "root:default-zone", data: { type: "card", props: { id: "c1", title: "Hi" } } });
    // Refused: unknown block, permission, bad shapes, unknown action types.
    await action(5, { type: "insert", componentType: "evil", destinationIndex: 0, destinationZone: "root:default-zone" });
    await action(6, { type: "remove", index: 0, zone: "root:default-zone" });
    await action(7, { type: "move", sourceIndex: -1, sourceZone: "x", destinationIndex: 0, destinationZone: "y" });
    await action(8, { type: "set", state: { data: {} } });
    await action(9, { type: "replace", destinationIndex: 0, destinationZone: "z", data: { type: "card", props: { big: "x".repeat(LIMITS.rpcBytes) } } });
    expect(h.actions).toEqual([
      [1, { type: "insert", componentType: "card", destinationIndex: 0, destinationZone: "root:default-zone", id: "c1" }],
      [2, { type: "move", sourceIndex: 0, sourceZone: "root:default-zone", destinationIndex: 1, destinationZone: "hero-1:content" }],
      // Only the selection crosses: other UI state stays the editor's.
      [3, { type: "setUi", ui: { itemSelector: { index: 0, zone: "root:default-zone" } } }],
      [4, { type: "replace", destinationIndex: 0, destinationZone: "root:default-zone", data: { type: "card", props: { id: "c1", title: "Hi" } } }],
      [5, null],
      [6, null],
      [7, null],
      [8, null],
      [9, null],
    ]);
    expect(h.errors).toEqual([
      "unknown block evil",
      "remove is not permitted",
      "invalid message from the editor",
      "invalid message from the editor",
      "action too large",
    ]);
  });

  it("forwards undo/redo intents and reports invalid messages", async () => {
    const h = harness();
    await h.from({ v: PROTOCOL_VERSION, type: "intent", intent: "undo" });
    await h.from({ v: PROTOCOL_VERSION, type: "intent", intent: "redo" });
    await h.from({ v: PROTOCOL_VERSION, type: "intent", intent: "publish" });
    await h.from({ v: PROTOCOL_VERSION, type: "change", data: { root: { props: {} }, content: [] } });
    await h.from({ v: 1, type: "ready" });
    expect(h.intents).toEqual(["undo", "redo"]);
    expect(h.errors).toEqual([
      "invalid message from the editor",
      "invalid message from the editor",
      "invalid message from the editor (protocol version mismatch)",
    ]);
  });

  it("runs allow-listed RPC handlers only, with size and rate limits", async () => {
    const resolveData = vi.fn(async (p: unknown) => ({ got: p }));
    const h = harness({
      resolveData,
      broken: () => Promise.reject(new Error("nope")),
      blob: () => new Blob(["x"]),
    });
    await h.from({
      v: PROTOCOL_VERSION,
      type: "rpc",
      id: 1,
      method: "resolveData",
      params: { block: "hero" },
    });
    await h.from({
      v: PROTOCOL_VERSION,
      type: "rpc",
      id: 2,
      method: "fetch",
      params: { url: "https://evil.test" },
    });
    await h.from({ v: PROTOCOL_VERSION, type: "rpc", id: 3, method: "toString", params: {} });
    await h.from({ v: PROTOCOL_VERSION, type: "rpc", id: 4, method: "broken", params: {} });
    await h.from({ v: PROTOCOL_VERSION, type: "rpc", id: 5, method: "blob", params: {} });
    await h.from({
      v: PROTOCOL_VERSION,
      type: "rpc",
      id: 6,
      method: "resolveData",
      params: { big: "x".repeat(LIMITS.rpcBytes) },
    });
    expect(h.sent).toEqual([
      {
        v: PROTOCOL_VERSION,
        type: "rpc:result",
        id: 1,
        ok: true,
        value: { got: { block: "hero" } },
      },
      {
        v: PROTOCOL_VERSION,
        type: "rpc:result",
        id: 2,
        ok: false,
        error: "unknown method fetch",
      },
      {
        v: PROTOCOL_VERSION,
        type: "rpc:result",
        id: 3,
        ok: false,
        error: "unknown method toString",
      },
      { v: PROTOCOL_VERSION, type: "rpc:result", id: 4, ok: false, error: "nope" },
      {
        v: PROTOCOL_VERSION,
        type: "rpc:result",
        id: 5,
        ok: false,
        error: "result too large or not JSON",
      },
      {
        v: PROTOCOL_VERSION,
        type: "rpc:result",
        id: 6,
        ok: false,
        error: "request too large",
      },
    ]);
    expect(resolveData).toHaveBeenCalledTimes(1);

    const r = harness({ resolveData });
    for (let i = 0; i < LIMITS.rpcPerSecond + 5; i++)
      await r.from({
        v: PROTOCOL_VERSION,
        type: "rpc",
        id: i,
        method: "resolveData",
        params: {},
      });
    expect(
      r.sent.filter(
        (m) => m.type === "rpc:result" && !m.ok && m.error === "rate limited",
      ),
    ).toHaveLength(5);
    r.tick(1000);
    await r.from({
      v: PROTOCOL_VERSION,
      type: "rpc",
      id: 99,
      method: "resolveData",
      params: {},
    });
    expect(r.sent.at(-1)).toMatchObject({ id: 99, ok: true });
  });

  it("uploads: File/Blob params are allowed up to the upload limit", async () => {
    const upload = vi.fn(async (p: unknown) => ({
      size: (p as { file: Blob }).file.size,
    }));
    const h = harness({ upload });
    await h.from({
      v: PROTOCOL_VERSION,
      type: "rpc",
      id: 1,
      method: "upload",
      params: { file: new Blob(["hello"]) },
    });
    expect(h.sent.at(-1)).toEqual({
      v: PROTOCOL_VERSION,
      type: "rpc:result",
      id: 1,
      ok: true,
      value: { size: 5 },
    });
    await h.from({
      v: PROTOCOL_VERSION,
      type: "rpc",
      id: 2,
      method: "upload",
      params: { file: new Blob([new Uint8Array(LIMITS.uploadBytes + 1)]) },
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(h.errors.at(-1)).toBe("message too large or not serializable");
  });
});

describe("editor side (<PuckRemoteEditor>)", () => {
  it("proposes only replayable actions; host-applied ones (recordHistory false) stay local", () => {
    expect(toFrameAction({ type: "insert", componentType: "card", destinationIndex: 0, destinationZone: "root:default-zone", id: "c1" })).toEqual({ type: "insert", componentType: "card", destinationIndex: 0, destinationZone: "root:default-zone", id: "c1" });
    expect(toFrameAction({ type: "setUi", ui: { itemSelector: null, leftSideBarVisible: false } })).toEqual({ type: "setUi", ui: { itemSelector: null } });
    expect(toFrameAction({ type: "setUi", ui: { leftSideBarVisible: false } })).toBeNull();
    expect(toFrameAction({ type: "setData", data: {} })).toBeNull();
    expect(toFrameAction({ type: "registerZone", zone: "x" })).toBeNull();
    expect(toFrameAction({ type: "remove", index: 0, zone: "z", recordHistory: false })).toBeNull();
  });

  it("applies a host state only once the host has seen every local action", () => {
    const sync = createFrameSync();
    expect(sync.accepts(0)).toBe(true);
    expect(sync.local({ type: "setUi", ui: { isDragging: true } } as never)).toBeNull();
    expect(sync.local({ type: "remove", index: 0, zone: "z" })).toEqual({ seq: 1, action: { type: "remove", index: 0, zone: "z" } });
    expect(sync.local({ type: "remove", index: 0, zone: "z" })?.seq).toBe(2);
    expect(sync.accepts(1)).toBe(false); // older than our second edit
    expect(sync.accepts(2)).toBe(true);
  });

  it("accepts init only on the configured editor origin, from a configured admin origin, with theme URLs on an admin origin", () => {
    expect(initProblem(payload, ADMIN, EDITOR)).toBeNull();
    expect(initProblem(payload, ADMIN, "https://elsewhere.test")).toMatch(
      /not on the configured editor origin/,
    );
    expect(initProblem(payload, "https://evil.test", EDITOR)).toMatch(
      /not a configured host origin/,
    );
    expect(
      initProblem(
        { ...payload, bundleUrl: "https://cdn.evil.test/x.js" },
        ADMIN,
        EDITOR,
      ),
    ).toMatch(/not on a host origin/);
    expect(
      initProblem(
        { ...payload, origins: { host: [ADMIN, EDITOR], editor: EDITOR } },
        ADMIN,
        EDITOR,
      ),
    ).toMatch(/must not share/);
  });
});

describe("plugin panels (rail on the admin page)", () => {
  it("the ui message names the frame plugin to show, or null", () => {
    expect(hostToEditorSchema.safeParse({ v: PROTOCOL_VERSION, type: "ui", leftSideBarVisible: true, plugin: "blocks" }).success).toBe(true);
    expect(hostToEditorSchema.safeParse({ v: PROTOCOL_VERSION, type: "ui", leftSideBarVisible: false, plugin: null }).success).toBe(true);
    expect(hostToEditorSchema.safeParse({ v: PROTOCOL_VERSION, type: "ui", leftSideBarVisible: true }).success).toBe(false);
    expect(hostToEditorSchema.safeParse({ v: PROTOCOL_VERSION, type: "ui", leftSideBarVisible: true, plugin: "x".repeat(65) }).success).toBe(false);
  });

  it("frameUi: a frame plugin opens in the frame and collapses this side; others stay here", () => {
    expect(frameUi("blocks", ["blocks"], true)).toEqual({ collapseHere: true, frame: { leftSideBarVisible: true, plugin: "blocks" } });
    // The rail toggle hides the frame's panel too.
    expect(frameUi("blocks", ["blocks"], false)).toEqual({ collapseHere: true, frame: { leftSideBarVisible: false, plugin: "blocks" } });
    expect(frameUi("outline", ["blocks"], true)).toEqual({ collapseHere: false, frame: { leftSideBarVisible: false, plugin: null } });
    expect(frameUi(null, ["blocks"], true)).toEqual({ collapseHere: false, frame: { leftSideBarVisible: false, plugin: null } });
  });
});

describe("shared helpers", () => {
  it("stripResolved removes resolved data everywhere, slots and zones included", () => {
    const data = {
      root: { props: { title: "T", __data: { x: 1 } }, readOnly: { __data: true } },
      content: [
        { type: "hero", props: { id: "h", __data: { a: 1 }, content: [{ type: "card", props: { id: "c", __data: {} }, readOnly: { __data: true, title: true } }] } },
      ],
      zones: { "h:z": [{ type: "card", props: { id: "z", __data: {} } }] },
    };
    expect(stripResolved(data)).toEqual({
      root: { props: { title: "T" } },
      content: [{ type: "hero", props: { id: "h", content: [{ type: "card", props: { id: "c" }, readOnly: { title: true } }] } }],
      zones: { "h:z": [{ type: "card", props: { id: "z" } }] },
    });
  });

  it("the host's config has placeholder renders; the editor's has no resolveData", () => {
    const theme = placeholderTheme({ blocks: { hero: {}, card: {} }, root: {} } as never);
    expect(Object.keys(theme.blocks)).toEqual(["hero", "card"]);
    expect(theme.blocks.hero.render({} as never, {} as never, {} as never)).toBeNull();
    const config = withoutResolveData({ components: { a: { render: () => null, resolveData: async () => ({}) } }, root: { resolveData: async () => ({}) } } as never);
    expect(config.components.a.resolveData).toBeUndefined();
    expect(config.root?.resolveData).toBeUndefined();
  });
});
