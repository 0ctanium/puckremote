// @vitest-environment happy-dom
/** The header's template selector: the tree, Puck's title slot, the drill-down and the keyboard. */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { templateNameOf } from "../../core/src/server/manifest-schema.ts";
import { PuckEditorFrame, TemplateSelector, templateNames, templateTree, type TemplateSwitcherProps } from "../src/frame.tsx";
import type { EditorPayload } from "../src/protocol.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const files = {
  "bundle.js": "a",
  "manifest.json": "b",
  "templates/search.json": "c",
  "templates/home.json": "d",
  "templates/blog/post.json": "e",
  "templates/blog/archive/2026.json": "f",
  "templates/Bad.json": "g",
  "templates/readme.md": "h",
  "assets/templates/x.json": "i",
};
const NAMES = ["blog/archive/2026", "blog/post", "home", "search"];

const payload = (template: string): EditorPayload => ({
  theme: "0123456789ab",
  hash: "a".repeat(64),
  template,
  params: {},
  root: { fields: {}, defaultProps: {} },
  manifest: { blocks: {}, root: null, categories: {}, files } as never,
  data: { root: { props: {} }, content: [] },
  bundleUrl: "https://admin.example.com/cdn/bundle.browser.js",
  assetBase: "https://admin.example.com/cdn/assets/",
  origins: { host: ["https://admin.example.com"], editor: "https://editor.example.net" },
  site: { name: "S", locale: "en" },
});

const href = (name: string) => `/editor?previewPath=/${name}`;

const serverRender = (template: string, extra: Partial<Parameters<typeof PuckEditorFrame>[0]> = {}) =>
  renderToStaticMarkup(<PuckEditorFrame payload={payload(template)} editorUrl="https://editor.example.net/" {...extra} />);

describe("templateNames", () => {
  it("lists template files, nested ones included, sorted", () => {
    expect(templateNames({ files })).toEqual(NAMES);
  });

  it("matches core's template paths", () => {
    for (const file of Object.keys(files)) {
      const name = templateNameOf(file);
      expect(templateNames({ files: { [file]: "x" } })).toEqual(name ? [name] : []);
    }
  });
});

describe("templateTree", () => {
  it("nests folders by path, sorted, templates before folders", () => {
    expect(templateTree(["search", "blog/post", "about/team", "home", "blog/archive/2026"])).toEqual({
      templates: ["home", "search"],
      folders: [
        { path: "about", tree: { templates: ["about/team"], folders: [] } },
        {
          path: "blog",
          tree: {
            templates: ["blog/post"],
            folders: [{ path: "blog/archive", tree: { templates: ["blog/archive/2026"], folders: [] } }],
          },
        },
      ],
    });
  });
});

describe("header (server render)", () => {
  it("renders the selector's trigger in Puck's title slot, with the full path", () => {
    const html = serverRender("blog/post", { templateHref: href });
    expect(html).toMatch(/<h2[^>]*>.*<button[^>]*aria-label="Template"/s);
    expect(html).toContain('<span class="prt-dir">blog / </span><span class="prt-name">post</span>');
  });

  it("keeps the static title without templateHref, with a headerTitle or with templateSwitcher false", () => {
    expect(serverRender("blog/post")).not.toContain('aria-label="Template"');
    expect(serverRender("blog/post")).toContain("/blog/post");
    expect(serverRender("home", { templateHref: href, headerTitle: "Custom" })).not.toContain('aria-label="Template"');
    expect(serverRender("home", { templateHref: href, templateSwitcher: false })).not.toContain('aria-label="Template"');
  });

  it("passes the templates (current included) to a custom switcher", () => {
    const Mine = ({ current, templates }: TemplateSwitcherProps) => <nav data-current={current}>{templates.join(",")}</nav>;
    expect(serverRender("about", { templateHref: href, templateSwitcher: Mine })).toContain(
      '<nav data-current="about">about,blog/archive/2026,blog/post,home,search</nav>',
    );
  });
});

// ---------------------------------------------------------------------------
// In the DOM
// ---------------------------------------------------------------------------

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

function mount(ui: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="Template"]')!;
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-prt-row]")];
const labels = () => rows().map((r) => r.textContent);
const crumbs = () => document.querySelector(".prt-crumbs")?.textContent ?? null;
const click = (el: Element) => act(() => (el as HTMLElement).click());
const key = (k: string) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const openSelector = () =>
  act(() => {
    // Radix opens on pointerdown/click depending on version: a click is enough for the trigger.
    trigger().click();
  });

describe("TemplateSelector", () => {
  it("opens at the root level: templates, then folders", () => {
    mount(<TemplateSelector current="blog/post" href={href}><TemplateSelector.Auto templates={NAMES} /></TemplateSelector>);
    expect(rows()).toEqual([]);
    openSelector();
    expect(labels()).toEqual(["home", "search", "blog"]);
    expect(document.querySelector(".prt-heading")?.textContent).toBe("Templates");
    expect(rows()[0].getAttribute("href")).toBe("/editor?previewPath=/home");
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("drills into folders, with a breadcrumb, back and crumb links", () => {
    mount(<TemplateSelector current="blog/post" href={href}><TemplateSelector.Auto templates={NAMES} /></TemplateSelector>);
    openSelector();
    click(rows()[2]);
    expect(labels()).toEqual(["post", "archive"]);
    expect(crumbs()).toBe("Templates/blog");
    const current = rows()[0];
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/editor?previewPath=/blog/post");
    click(rows()[1]);
    expect(labels()).toEqual(["2026"]);
    expect(crumbs()).toBe("Templates/blog/archive");
    click([...document.querySelectorAll(".prt-crumbs button")].find((b) => b.textContent === "blog")!);
    expect(labels()).toEqual(["post", "archive"]);
    click(document.querySelector('button[aria-label="Back"]')!);
    expect(labels()).toEqual(["home", "search", "blog"]);
    expect(crumbs()).toBeNull();
  });

  it("moves with the keyboard: arrows, Home/End, ArrowRight into a folder, ArrowLeft back", () => {
    mount(<TemplateSelector current="home" href={href}><TemplateSelector.Auto templates={NAMES} /></TemplateSelector>);
    openSelector();
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("search");
    key("End");
    expect(document.activeElement?.textContent).toBe("blog");
    key("Home");
    expect(document.activeElement?.textContent).toBe("home");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("home");
    key("End");
    key("ArrowRight");
    expect(labels()).toEqual(["post", "archive"]);
    expect(document.activeElement?.textContent).toBe("post");
    key("ArrowLeft");
    expect(labels()).toEqual(["home", "search", "blog"]);
  });

  it("takes a composed tree with labels and wrapper components, and shows empty folders", () => {
    const Hidden = ({ children }: { children: ReactNode }) => <>{children}</>;
    mount(
      <TemplateSelector current="blog/index" href={href}>
        <TemplateSelector.Template name="home" label="Home" />
        <Hidden>
          <TemplateSelector.Folder path="blog" label="Blog">
            <Hidden>
              <TemplateSelector.Template name="blog/index" label="Default" />
            </Hidden>
            <TemplateSelector.Template name="blog/dance" label="Dance" />
          </TemplateSelector.Folder>
        </Hidden>
        <TemplateSelector.Folder path="empty" label="Empty" />
      </TemplateSelector>,
    );
    openSelector();
    expect(labels()).toEqual(["Home", "Blog", "Empty"]);
    click(rows()[1]);
    expect(labels()).toEqual(["Default", "Dance"]);
    expect(rows()[0].getAttribute("aria-current")).toBe("page");
    expect(crumbs()).toBe("Templates/Blog");
    click(document.querySelector('button[aria-label="Back"]')!);
    click(rows()[2]);
    expect(rows()).toEqual([]);
    expect(document.querySelector(".prt-empty")?.textContent).toBe("No templates");
  });

  it("reads current and href from <PuckEditorFrame>'s provider when no props are given", () => {
    const Mine = () => (
      <TemplateSelector>
        <TemplateSelector.Template name="home" />
      </TemplateSelector>
    );
    const html = serverRender("home", { templateHref: href, templateSwitcher: Mine });
    expect(html).toContain('<span class="prt-name">home</span>');
  });
});
