/**
 * The framework-agnostic entry points (createCore → handleTheme / preparePage / readPage /
 * writePage / editorPayload / resolveBlockData), exercised exactly as any framework binding
 * calls them.
 */
import { publish } from "@puck-remote/cli";
import { mockCms } from "@puck-remote/source-mock";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fsArtifactStore } from "@puck-remote/artifacts-fs";
import {
  ConfigError,
  createCore,
  PageError,
  resolveConfig,
  UnknownBlockError,
  type PuckRemoteCore,
} from "../src/index.ts";
import { inProcessRenderer } from "../src/server/runtime/in-process.ts";
import { buildExample, counterStore, REPO_ROOT, withPages } from "./helpers.ts";

let core: PuckRemoteCore;
let dir: string;
let first: string;
const req = (p: string, init?: RequestInit) =>
  new Request(`http://host.test${p}`, init);
const ORIGINS = { host: ["http://admin.test"], editor: "http://editor.test" };

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  dir = await mkdtemp(path.join(os.tmpdir(), "puck-remote-routes-"));
  first = (
    await publish({
      distDir: (await buildExample()).outDir,
      artifacts: path.join(dir, "artifacts"),
      quiet: true,
    })
  ).id;
  core = createCore({
    id: `routes-${process.pid}`,
    artifacts: fsArtifactStore({ dir: path.join(dir, "artifacts") }),
    source: mockCms({ dataFile: path.join(REPO_ROOT, "data", "cms.json") }),
    routes: { theme: "/_remote/theme" },
    origins: ORIGINS,
  });
});
afterAll(async () => (await core.host()).store.close());

describe("createCore", () => {
  it("is memoized per config id (one runtime shared by all route bundles)", () => {
    expect(createCore({ id: `routes-${process.pid}` } as never)).toBe(core);
  });

  it("handleTheme serves assets and the browser bundle, never the isolate bundle, manifest or pages", async () => {
    const css = await core.handleTheme(
      req(`/_remote/theme/${first}/assets/theme.css`),
    );
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    // The editor (another origin) imports the browser bundle as a module: CORS for it only.
    const browser = await core.handleTheme(
      req(`/_remote/theme/${first}/bundle.browser.js`),
    );
    expect(browser.status).toBe(200);
    expect(browser.headers.get("access-control-allow-origin")).toBe(
      ORIGINS.editor,
    );
    expect(browser.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    for (const p of [
      `/_remote/theme/${first}/bundle.js`,
      `/_remote/theme/${first}/manifest.json`,
      `/_remote/theme/${first}/pages/home.json`,
      `/_remote/theme/${first}/assets/../manifest.json`,
      `/_remote/theme/${first}/assets/%2e%2e/manifest.json`,
      `/_remote/theme/${"0".repeat(64)}/bundle.browser.js`,
      `/_remote/theme/../bundle.browser.js`,
      `/theme/${first}/assets/theme.css`,
    ]) {
      const r = await core.handleTheme(req(p));
      expect(r.status, p).toBe(404);
      expect(r.headers.get("access-control-allow-origin"), p).toBeNull();
    }
    expect(
      (
        await core.handleTheme(
          req(`/_remote/theme/${first}/assets/theme.css`, { method: "POST" }),
        )
      ).status,
    ).toBe(405);
  });

  it("preparePage renders pages of the current artifact; unknown pages are null", async () => {
    const page = await core.preparePage("home");
    expect(page?.artifact).toBe(first);
    expect(
      page?.head.styles.some((s) =>
        s.startsWith(`/_remote/theme/${first}/assets/`),
      ),
    ).toBe(true);
    expect(await core.preparePage("nope")).toBeNull();
  });
});

describe("pages live in the artifact", () => {
  it("readPage reads the current artifact or a given one", async () => {
    const r = await core.readPage("home");
    expect(r?.artifact).toBe(first);
    expect(r?.data.content.length).toBeGreaterThan(0);
    expect((await core.readPage("home", { artifact: first }))?.artifact).toBe(
      first,
    );
    expect(await core.readPage("nope")).toBeNull();
    expect(
      await core.readPage("home", { artifact: "f".repeat(64) }),
    ).toBeNull();
  });

  it("writePage produces a new artifact (same code, new page) and never moves the pointer", async () => {
    const page = {
      root: { props: { title: "New" } },
      content: [
        {
          type: "card",
          props: { id: "c1", title: "Written", __data: { leak: true } },
          readOnly: { __data: true },
        },
      ],
    };
    const { id } = await core.writePage("about/team", page, { base: first });
    expect(id).not.toBe(first);
    const { artifacts } = core.config;
    expect(await artifacts.readPointer()).toBe(first);
    // Code files are identical; the manifest lists the new page.
    const art = (rel: string) =>
      readFile(path.join(dir, "artifacts", id, rel), "utf8");
    const base = (rel: string) =>
      readFile(path.join(dir, "artifacts", first, rel), "utf8");
    expect(await art("bundle.js")).toBe(await base("bundle.js"));
    expect(await art("pages/home.json")).toBe(await base("pages/home.json"));
    expect(Object.keys(JSON.parse(await art("manifest.json")).files)).toContain(
      "pages/about/team.json",
    );
    // Resolved data is stripped before storage.
    const stored = await art("pages/about/team.json");
    expect(stored).not.toContain("__data");
    expect(stored).not.toContain("readOnly");
    expect(
      (await core.readPage("about/team", { artifact: id }))?.data.content[0]
        .props.title,
    ).toBe("Written");
    expect(await core.readPage("about/team")).toBeNull(); // not current until the pointer moves

    // Going live is the caller's decision.
    await artifacts.writePointer(id);
    expect((await (await core.host()).store.reload()).ok).toBe(true);
    expect((await core.preparePage("about/team"))?.artifact).toBe(id);
    await artifacts.writePointer(first);
    await (await core.host()).store.reload();
  });

  it("writePage restores unknown blocks shown as placeholders, and rejects invalid input", async () => {
    const page = {
      root: { props: {} },
      content: [
        {
          type: "__missing",
          props: {
            id: "m1",
            originalType: "old-banner",
            originalProps: { id: "m1", text: "kept" },
          },
        },
      ],
    };
    const { id } = await core.writePage("legacy", page, { base: first });
    const stored = JSON.parse(
      await readFile(
        path.join(dir, "artifacts", id, "pages", "legacy.json"),
        "utf8",
      ),
    );
    expect(stored.content[0]).toEqual({
      type: "old-banner",
      props: { id: "m1", text: "kept" },
    });

    await expect(
      core.writePage("home", { nope: true }, { base: first }),
    ).rejects.toThrow(PageError);
    await expect(
      core.writePage(
        "../x",
        { root: { props: {} }, content: [] },
        { base: first },
      ),
    ).rejects.toThrow(PageError);
    await expect(
      core.writePage(
        "home",
        { root: { props: {} }, content: [] },
        { base: "../x" },
      ),
    ).rejects.toThrow(PageError);
    await expect(
      core.writePage(
        "home",
        { root: { props: {} }, content: [] },
        { base: "f".repeat(64) },
      ),
    ).rejects.toThrow(PageError);
    const huge = {
      root: { props: { blob: "x".repeat(2 * 1024 * 1024) } },
      content: [],
    };
    await expect(core.writePage("home", huge, { base: first })).rejects.toThrow(
      /larger than/,
    );
  });
});

describe("editor entry points", () => {
  it("editorPayload: page, manifest, absolute theme URLs on the admin origin, origins", async () => {
    const p = await core.editorPayload("home");
    expect(p.artifact).toBe(first);
    expect(p.bundleUrl).toBe(
      `http://admin.test/_remote/theme/${first}/bundle.browser.js`,
    );
    expect(p.assetBase).toBe(
      `http://admin.test/_remote/theme/${first}/assets/`,
    );
    expect(p.origins).toEqual(ORIGINS);
    expect(Object.keys(p.manifest.blocks)).toContain("hero");
    expect(JSON.parse(JSON.stringify(p))).toEqual(p); // JSON only: it crosses postMessage
    // A page the theme doesn't have yet starts empty, with the root defaults.
    expect((await core.editorPayload("new-page")).data.content).toEqual([]);
  });

  it("editorPayload needs origins", async () => {
    const bare = createCore({
      id: `routes-bare-${process.pid}`,
      artifacts: core.config.artifacts,
      source: core.config.source,
    });
    await expect(bare.editorPayload("home")).rejects.toThrow(ConfigError);
    (await bare.host()).store.close();
  });

  it("resolveBlockData runs the manifest spec in draft mode; only block + props come from the caller", async () => {
    const r = await core.resolveBlockData("home", "latest-posts", {
      count: 1,
      spec: { source: "http", origin: "https://evil.test" },
    });
    expect(r.data.posts.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("evil");
    await expect(core.resolveBlockData("home", "nope", {})).rejects.toThrow(
      UnknownBlockError,
    );
  });
});

describe("origins config", () => {
  const base = {
    artifacts: counterStore(),
    source: mockCms({ data: { collections: {}, globals: {} } }),
  };
  it("rejects an editor origin equal to an admin origin, and an empty admin list", () => {
    expect(() =>
      resolveConfig({
        ...base,
        origins: { host: ["http://a.test"], editor: "http://a.test/" },
      }),
    ).toThrow(ConfigError);
    expect(() =>
      resolveConfig({
        ...base,
        origins: { host: [], editor: "http://e.test" },
      }),
    ).toThrow(ConfigError);
    expect(
      resolveConfig({
        ...base,
        origins: { host: ["http://a.test/"], editor: "http://e.test/x" },
      }).origins,
    ).toEqual({ host: ["http://a.test"], editor: "http://e.test" });
  });
});

describe("any ArtifactStore: ids are opaque", () => {
  it("renders, reads and writes pages with a counter-id store", async () => {
    const store = counterStore();
    const dist = await withPages((await buildExample()).outDir, {
      home: {
        root: { props: { title: "Counter" } },
        content: [{ type: "card", props: { id: "c", title: "Hi" } }],
      },
    });
    const { id } = await publish({
      distDir: dist,
      artifacts: store,
      quiet: true,
    });
    expect(id).toBe("a1");
    const c = createCore({
      id: `routes-counter-${process.pid}`,
      artifacts: store,
      source: core.config.source,
      renderer: inProcessRenderer(),
      origins: ORIGINS,
    });
    expect((await c.preparePage("home"))?.artifact).toBe("a1");
    const w = await c.writePage(
      "home",
      { root: { props: { title: "Two" } }, content: [] },
      { base: "a1" },
    );
    expect(w.id).toBe("a2");
    expect(
      (await c.readPage("home", { artifact: "a2" }))?.data.root.props?.title,
    ).toBe("Two");
    expect((await c.editorPayload("home")).bundleUrl).toBe(
      "http://admin.test/theme/a1/bundle.browser.js",
    );
    const asset = await c.handleTheme(req("/theme/a1/assets/theme.css"));
    expect(asset.status).toBe(200);
    (await c.host()).store.close();
  });
});
