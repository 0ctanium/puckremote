/**
 * The framework-agnostic entry points (createCore → handleTheme / prepareTemplate / readTemplate /
 * writeTemplate / editorPayload / resolveBlockData), exercised exactly as any framework binding
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
  TemplateError,
  resolveConfig,
  UnknownBlockError,
  type PuckRemoteCore,
} from "../src/index.ts";
import { inProcessRenderer } from "../src/server/runtime/in-process.ts";
import { fileResponse, INDEX_REFRESH_MS, ThemeFiles } from "../src/server/static-files.ts";
import type { ArtifactStore } from "@puck-remote/sdk/host";
import { createHash } from "node:crypto";
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

  it("prepareTemplate renders templates of the current artifact; unknown templates are null", async () => {
    const page = await core.prepareTemplate("home");
    expect(page?.artifact).toBe(first);
    expect(
      page?.head.styles.some((s) =>
        /^\/_remote\/theme\/assets\/theme\.css\?v=[0-9a-f]{12}$/.test(s),
      ),
    ).toBe(true);
    expect(await core.prepareTemplate("nope")).toBeNull();
  });
});

describe("templates live in the artifact", () => {
  it("readTemplate reads the current artifact or a given one", async () => {
    const r = await core.readTemplate("home");
    expect(r?.artifact).toBe(first);
    expect(r?.data.content.length).toBeGreaterThan(0);
    expect((await core.readTemplate("home", { artifact: first }))?.artifact).toBe(
      first,
    );
    expect(await core.readTemplate("nope")).toBeNull();
    expect(
      await core.readTemplate("home", { artifact: "f".repeat(64) }),
    ).toBeNull();
  });

  it("writeTemplate produces a new artifact (same code, new template) and never moves the pointer", async () => {
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
    const { id } = await core.writeTemplate("about/team", page, { base: first });
    expect(id).not.toBe(first);
    const { artifacts } = core.config;
    expect(await artifacts.readPointer()).toBe(first);
    // Code files are identical; the manifest lists the new page.
    const art = (rel: string) =>
      readFile(path.join(dir, "artifacts", id, rel), "utf8");
    const base = (rel: string) =>
      readFile(path.join(dir, "artifacts", first, rel), "utf8");
    expect(await art("bundle.js")).toBe(await base("bundle.js"));
    expect(await art("templates/home.json")).toBe(await base("templates/home.json"));
    expect(Object.keys(JSON.parse(await art("manifest.json")).files)).toContain(
      "templates/about/team.json",
    );
    // Resolved data is stripped before storage.
    const stored = await art("templates/about/team.json");
    expect(stored).not.toContain("__data");
    expect(stored).not.toContain("readOnly");
    expect(
      (await core.readTemplate("about/team", { artifact: id }))?.data.content[0]
        .props.title,
    ).toBe("Written");
    expect(await core.readTemplate("about/team")).toBeNull(); // not current until the pointer moves

    // Going live is the caller's decision.
    await artifacts.writePointer(id);
    expect((await (await core.host()).store.reload()).ok).toBe(true);
    expect((await core.prepareTemplate("about/team"))?.artifact).toBe(id);
    await artifacts.writePointer(first);
    await (await core.host()).store.reload();
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
    const { id } = await core.writeTemplate("legacy", page, { base: first });
    const stored = JSON.parse(
      await readFile(
        path.join(dir, "artifacts", id, "templates", "legacy.json"),
        "utf8",
      ),
    );
    expect(stored.content[0]).toEqual({
      type: "old-banner",
      props: { id: "m1", text: "kept" },
    });

    await expect(
      core.writeTemplate("home", { nope: true }, { base: first }),
    ).rejects.toThrow(TemplateError);
    await expect(
      core.writeTemplate(
        "../x",
        { root: { props: {} }, content: [] },
        { base: first },
      ),
    ).rejects.toThrow(TemplateError);
    await expect(
      core.writeTemplate(
        "home",
        { root: { props: {} }, content: [] },
        { base: "../x" },
      ),
    ).rejects.toThrow(TemplateError);
    await expect(
      core.writeTemplate(
        "home",
        { root: { props: {} }, content: [] },
        { base: "f".repeat(64) },
      ),
    ).rejects.toThrow(TemplateError);
    const huge = {
      root: { props: { blob: "x".repeat(2 * 1024 * 1024) } },
      content: [],
    };
    await expect(core.writeTemplate("home", huge, { base: first })).rejects.toThrow(
      /larger than/,
    );
  });
});

describe("editor entry points", () => {
  it("editorPayload: template, manifest, absolute theme URLs on the admin origin, origins", async () => {
    const p = await core.editorPayload("home");
    expect(p.artifact).toBe(first);
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
  /** The example artifact with another theme.css (manifest hash updated). */
  async function variant(store: ArtifactStore, base: string, css: string) {
    const manifest = JSON.parse(new TextDecoder().decode((await store.readFile(base, "manifest.json"))!));
    const files: Record<string, Uint8Array> = {};
    for (const rel of Object.keys(manifest.files)) files[rel] = (await store.readFile(base, rel))!;
    files["assets/theme.css"] = new TextEncoder().encode(css);
    manifest.files["assets/theme.css"] = sha(css);
    files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
    return { id: await store.writeArtifact(files), v: sha(css).slice(0, 12) };
  }

  it("serves current and older versions immutably, anything else as the current file with an etag", async () => {
    const store = fsArtifactStore({ dir: path.join(dir, "versions") });
    const { id: a } = await publish({ distDir: (await buildExample()).outDir, artifacts: store, quiet: true });
    await store.writePointer(a);
    const old = await variant(store, a, "body{color:red}");
    const cur = await variant(store, a, "body{color:blue}");
    await store.writePointer(cur.id);
    let now = 0;
    const tf = new ThemeFiles(store, () => now);
    const text = async (p: string, v: string | null) => {
      const r = await tf.get(p, v);
      return r && { css: new TextDecoder().decode(r.file.body), immutable: r.immutable };
    };
    expect(await text("assets/theme.css", cur.v)).toEqual({ css: "body{color:blue}", immutable: true });
    expect(tf.refreshes).toBe(0); // the current artifact never needs the index
    // A page rendered before the publish still gets its own version (D-0264).
    expect(await text("assets/theme.css", old.v)).toEqual({ css: "body{color:red}", immutable: true });
    expect(tf.refreshes).toBe(1);
    // No v (e.g. a relative url() in CSS) or an unknown one: the current file, revalidated.
    expect(await text("assets/theme.css", null)).toEqual({ css: "body{color:blue}", immutable: false });
    expect(await text("assets/theme.css", "0".repeat(12))).toEqual({ css: "body{color:blue}", immutable: false });
    expect(await text("assets/theme.css", "not-a-version")).toEqual({ css: "body{color:blue}", immutable: false });
    expect(await tf.get("assets/missing.css", cur.v)).toBeNull();
    // Random versions can't make it rescan the store more than once per INDEX_REFRESH_MS.
    for (let i = 0; i < 50; i++) await tf.get("assets/theme.css", i.toString(16).padStart(12, "f"));
    expect(tf.refreshes).toBe(1);
    now += INDEX_REFRESH_MS;
    await tf.get("assets/theme.css", "f".repeat(12));
    expect(tf.refreshes).toBe(2);

    const res = fileResponse(await tf.get("assets/theme.css", null), new Request("http://h.test/"));
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag")!;
    expect(etag).toBe(`"${sha("body{color:blue}")}"`);
    const again = fileResponse(await tf.get("assets/theme.css", null), new Request("http://h.test/", { headers: { "if-none-match": etag } }));
    expect(again.status).toBe(304);
  });
});

describe("any ArtifactStore: ids are opaque", () => {
  it("renders, reads and writes templates with a counter-id store", async () => {
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
    expect((await c.prepareTemplate("home"))?.artifact).toBe("a1");
    const w = await c.writeTemplate(
      "home",
      { root: { props: { title: "Two" } }, content: [] },
      { base: "a1" },
    );
    expect(w.id).toBe("a2");
    expect(
      (await c.readTemplate("home", { artifact: "a2" }))?.data.root.props?.title,
    ).toBe("Two");
    // A page save is a new artifact, but unchanged files keep their URLs (D-0262).
    const before = (await c.prepareTemplate("home"))!.head;
    await store.writePointer(w.id);
    await (await c.host()).store.reload();
    const after = (await c.prepareTemplate("home"))!;
    expect(after.artifact).toBe("a2");
    expect(after.head.styles).toEqual(before.styles);
    expect(after.head.scripts).toEqual(before.scripts);
    expect((await c.editorPayload("home")).bundleUrl).toMatch(
      /^http:\/\/admin\.test\/cdn\/bundle\.browser\.js\?v=[0-9a-f]{12}$/,
    );
    const asset = await c.handleTheme(req("/cdn/assets/theme.css"));
    expect(asset.status).toBe(200);
    (await c.host()).store.close();
  });
});
