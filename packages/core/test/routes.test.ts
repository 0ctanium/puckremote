/**
 * The framework-agnostic entry points (createCore → handleTheme / prepareTemplate / readTemplate /
 * writeTemplate / editorPayload / resolveBlockData), exercised exactly as any framework binding
 * calls them.
 */
import { mockCms } from "@puck-remote/source-mock";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fsArtifactStore } from "@puck-remote/artifacts-fs";
import {
  ConfigError,
  createCore,
  TemplateError,
  resolveConfig,
  UnknownBlockError,
  type PuckRemoteCore,
} from "../src/index.ts";
import { inProcessRenderer } from "../src/server/runtime/in-process.ts";
import { fileResponse, ThemeFiles } from "../src/server/static-files.ts";
import { createHash } from "node:crypto";
import { buildExample, counterStore, publish, REPO_ROOT, withPages } from "./helpers.ts";

let core: PuckRemoteCore;
let dir: string;
/** The main theme's id, and its current hash (templates written below change it). */
let main: string;
let first: string;
const req = (p: string, init?: RequestInit) =>
  new Request(`http://host.test${p}`, init);
const ORIGINS = { host: ["http://admin.test"], editor: "http://editor.test" };

beforeAll(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  dir = await mkdtemp(path.join(os.tmpdir(), "puck-remote-routes-"));
  ({ theme: main, hash: first } = await publish({
    distDir: (await buildExample()).outDir,
    artifacts: path.join(dir, "artifacts"),
    quiet: true,
  }));
  core = createCore({
    id: `routes-${process.pid}`,
    artifacts: fsArtifactStore({ dir: path.join(dir, "artifacts") }),
    source: mockCms({ dataFile: path.join(REPO_ROOT, "examples", "app", "data", "cms.json") }),
    routes: { theme: "/_remote/theme" },
    origins: ORIGINS,
  });
});
afterAll(async () => (await core.host()).store.close());

describe("createCore", () => {
  it("is memoized per config id (one runtime shared by all route bundles)", () => {
    expect(createCore({ id: `routes-${process.pid}` } as never)).toBe(core);
  });

  it("handleTheme serves assets and the browser bundle, never the isolate bundle, manifest or templates", async () => {
    const files = (await core.host()).store.get().manifest.files;
    const v = (p: string) => files[p].slice(0, 12);
    const css = await core.handleTheme(
      req(`/_remote/theme/assets/theme.css?v=${v("assets/theme.css")}`),
    );
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(css.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    // The editor (another origin) imports the browser bundle as a module: CORS for it only.
    const browser = await core.handleTheme(
      req(`/_remote/theme/bundle.browser.js?v=${v("bundle.browser.js")}`),
    );
    expect(browser.status).toBe(200);
    expect(browser.headers.get("access-control-allow-origin")).toBe(
      ORIGINS.editor,
    );
    expect(browser.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    for (const p of [
      `/_remote/theme/bundle.js`,
      `/_remote/theme/manifest.json`,
      `/_remote/theme/templates/home.json`,
      `/_remote/theme/assets/../manifest.json`,
      `/_remote/theme/assets/%2e%2e/manifest.json`,
      `/_remote/theme/assets/nope.css`,
      // The old layout (artifact id in the path) is gone (D-0270).
      `/_remote/theme/${first}/assets/theme.css`,
      `/theme/assets/theme.css`,
    ]) {
      const r = await core.handleTheme(req(p));
      expect(r.status, p).toBe(404);
      expect(r.headers.get("access-control-allow-origin"), p).toBeNull();
    }
    expect(
      (
        await core.handleTheme(
          req(`/_remote/theme/assets/theme.css`, { method: "POST" }),
        )
      ).status,
    ).toBe(405);
  });

  it("prepareTemplate renders templates of the main theme; unknown templates are null", async () => {
    const page = await core.prepareTemplate("home");
    expect(page?.theme).toEqual({ id: main, hash: first });
    expect(
      page?.head.styles.some((s) =>
        /^\/_remote\/theme\/assets\/theme\.css\?v=[0-9a-f]{12}$/.test(s),
      ),
    ).toBe(true);
    expect(await core.prepareTemplate("nope")).toBeNull();
  });
});

describe("templates live in the theme", () => {
  it("readTemplate reads the main theme or a given one", async () => {
    const r = await core.readTemplate("home");
    expect(r).toMatchObject({ theme: main, hash: first });
    expect(r?.data.content.length).toBeGreaterThan(0);
    expect((await core.readTemplate("home", { theme: main }))?.hash).toBe(first);
    expect(await core.readTemplate("nope")).toBeNull();
    expect(await core.readTemplate("home", { theme: "ffffffffffff" })).toBeNull();
  });

  it("writeTemplate writes the template and manifest into the theme (other files untouched) and returns its new hash", async () => {
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
    const file = (rel: string) => readFile(path.join(dir, "artifacts", "themes", main, rel), "utf8");
    const bundleBefore = await file("bundle.js");
    const { hash } = await core.writeTemplate("about/team", page, { theme: main, expect: first });
    expect(hash).not.toBe(first);
    expect((await core.themes.get(main))?.hash).toBe(hash);
    expect(await file("bundle.js")).toBe(bundleBefore);
    expect(Object.keys(JSON.parse(await file("manifest.json")).files)).toContain("templates/about/team.json");
    // Resolved data is stripped before storage.
    const stored = await file("templates/about/team.json");
    expect(stored).not.toContain("__data");
    expect(stored).not.toContain("readOnly");
    expect((await core.readTemplate("about/team"))?.data.content[0].props.title).toBe("Written");
    // The main theme reloads by itself.
    expect((await core.prepareTemplate("about/team"))?.theme.hash).toBe(hash);
    // A save on an old version is refused.
    await expect(core.writeTemplate("about/team", page, { theme: main, expect: first })).rejects.toMatchObject({ status: 409 });
    first = hash;
  });

  it("writeTemplate restores unknown blocks shown as placeholders, and rejects invalid input", async () => {
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
    ({ hash: first } = await core.writeTemplate("legacy", page, { theme: main }));
    const stored = JSON.parse(await readFile(path.join(dir, "artifacts", "themes", main, "templates", "legacy.json"), "utf8"));
    expect(stored.content[0]).toEqual({
      type: "old-banner",
      props: { id: "m1", text: "kept" },
    });

    await expect(core.writeTemplate("home", { nope: true }, { theme: main })).rejects.toThrow(TemplateError);
    await expect(core.writeTemplate("../x", { root: { props: {} }, content: [] }, { theme: main })).rejects.toThrow(TemplateError);
    await expect(core.writeTemplate("home", { root: { props: {} }, content: [] }, { theme: "ffffffffffff" })).rejects.toThrow(TemplateError);
    const huge = {
      root: { props: { blob: "x".repeat(2 * 1024 * 1024) } },
      content: [],
    };
    await expect(core.writeTemplate("home", huge, { theme: main })).rejects.toThrow(/larger than/);
  });
});

describe("editor entry points", () => {
  it("editorPayload: template, manifest, absolute theme URLs on the admin origin, origins", async () => {
    const p = await core.editorPayload("home");
    expect(p).toMatchObject({ theme: main, hash: first });
    expect(p.bundleUrl).toBe(
      `http://admin.test/_remote/theme/bundle.browser.js?v=${p.manifest.files["bundle.browser.js"].slice(0, 12)}`,
    );
    expect(p.assetBase).toBe(`http://admin.test/_remote/theme/assets/`);
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

  it("resolveBlockData runs the manifest spec; only block + props come from the caller", async () => {
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

  it("resolveBlockData forwards the request to a requireRequest source (none: anonymous)", async () => {
    const withDrafts = createCore({
      id: `routes-request-${process.pid}`,
      artifacts: core.config.artifacts,
      source: mockCms({
        dataFile: path.join(REPO_ROOT, "examples", "app", "data", "cms.json"),
        canReadDrafts: (r) => r.headers.get("authorization") === "editor",
      }),
    });
    const editor = new Request("http://admin.test/", { headers: { authorization: "editor" } });
    const titles = async (request?: Request) =>
      JSON.stringify(await withDrafts.resolveBlockData("home", "latest-posts", { count: 12 }, { request }));
    expect(await titles(editor)).toContain("DRAFT");
    expect(await titles()).not.toContain("DRAFT");
    (await withDrafts.host()).store.close();
  });
});

describe("templates: app root fields and params", () => {
  it("editorPayload sends the merged root (app fields first) and the params", async () => {
    const withRoot = createCore({
      id: `routes-root-${process.pid}`,
      artifacts: core.config.artifacts,
      source: core.config.source,
      origins: ORIGINS,
      root: { fields: { seo: { type: "text" } }, defaultProps: { seo: "x" } },
    });
    const p = await withRoot.editorPayload("new-template", { params: { slug: "new-template" } });
    expect(p.template).toBe("new-template");
    expect(p.params).toEqual({ slug: "new-template" });
    expect(Object.keys(p.root.fields)[0]).toBe("seo");
    expect(p.root.fields).toHaveProperty("theme");
    // A template the theme doesn't have yet starts with the merged root defaults.
    expect(p.data.root.props).toMatchObject({ seo: "x", theme: "light" });
    await expect(withRoot.editorPayload("home", { params: { n: 1 } as never })).rejects.toThrow(TemplateError);
    (await withRoot.host()).store.close();
  });

  it("prepareTemplate keeps the params it rendered with", async () => {
    const t = (await core.prepareTemplate("home", { params: { slug: "home" } }))!;
    expect(t.template).toBe("home");
    expect(t.params).toEqual({ slug: "home" });
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

describe("theme file versions (?v=)", () => {
  const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

  it("immutable for a matching v, otherwise the main file with an etag; the index follows the theme list", async () => {
    const store = fsArtifactStore({ dir: path.join(dir, "versions") });
    await publish({ distDir: (await buildExample()).outDir, artifacts: store, quiet: true });
    const tf = new ThemeFiles(store);
    const css = (await tf.get("assets/theme.css", null))!;
    const v = css.file.sha256.slice(0, 12);
    expect((await tf.get("assets/theme.css", v))?.immutable).toBe(true);
    for (const bad of [null, "0".repeat(12), "not-a-version"]) expect((await tf.get("assets/theme.css", bad))?.immutable).toBe(false);
    expect(await tf.get("assets/missing.css", v)).toBeNull();
    // Unknown versions never rescan: the index is rebuilt only when the theme list changes.
    for (let i = 0; i < 50; i++) await tf.get("assets/theme.css", i.toString(16).padStart(12, "f"));
    expect(tf.refreshes).toBe(1);

    const res = fileResponse(await tf.get("assets/theme.css", null), new Request("http://h.test/"));
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag")!;
    expect(etag).toBe(`"${sha(css.file.body)}"`);
    const again = fileResponse(await tf.get("assets/theme.css", null), new Request("http://h.test/", { headers: { "if-none-match": etag } }));
    expect(again.status).toBe(304);
  });
});

describe("any ArtifactStore", () => {
  it("renders, reads and writes templates with an in-memory store", async () => {
    const store = counterStore();
    const dist = await withPages((await buildExample()).outDir, {
      home: {
        root: { props: { title: "Counter" } },
        content: [{ type: "card", props: { id: "c", title: "Hi" } }],
      },
    });
    const { theme, hash } = await publish({ distDir: dist, artifacts: store, quiet: true });
    const c = createCore({
      id: `routes-counter-${process.pid}`,
      artifacts: store,
      source: core.config.source,
      renderer: inProcessRenderer(),
      origins: ORIGINS,
    });
    const before = (await c.prepareTemplate("home"))!;
    expect(before.theme).toEqual({ id: theme, hash });
    const w = await c.writeTemplate("home", { root: { props: { title: "Two" } }, content: [] }, { theme, expect: hash });
    expect((await c.readTemplate("home"))?.data.root.props?.title).toBe("Two");
    // A template save changes two files only: assets and bundles keep their URLs (D-0262).
    const after = (await c.prepareTemplate("home"))!;
    expect(after.theme.hash).toBe(w.hash);
    expect(after.head.styles).toEqual(before.head.styles);
    expect(after.head.scripts).toEqual(before.head.scripts);
    expect((await c.editorPayload("home")).bundleUrl).toMatch(
      /^http:\/\/admin\.test\/cdn\/bundle\.browser\.js\?v=[0-9a-f]{12}$/,
    );
    const asset = await c.handleTheme(req("/cdn/assets/theme.css"));
    expect(asset.status).toBe(200);
    (await c.host()).store.close();
  });
});
