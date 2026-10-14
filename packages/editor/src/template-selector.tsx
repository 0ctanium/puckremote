"use client";
/**
 * The template selector in the admin header (like Shopify's): a ghost button showing the template
 * being edited, opening a popover that lists templates and folders. A folder replaces the list
 * with its contents, with a back button and a breadcrumb. Templates are links (the app's href).
 *
 * The tree is composable: <TemplateSelector.Template> and <TemplateSelector.Folder> may be
 * wrapped, filtered and ordered freely. Each node reads its level from context and renders only
 * when that level is the one open.
 *
 *   <TemplateSelector>
 *     <TemplateSelector.Template name="home" label="Home" />
 *     <TemplateSelector.Folder path="blog" label="Blog">
 *       <TemplateSelector.Template name="blog/post" label="Post" />
 *     </TemplateSelector.Folder>
 *   </TemplateSelector>
 */
import * as Popover from "@radix-ui/react-popover";
import type { Manifest } from "@puck-remote/core";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface TemplateSwitcherProps {
  /** The template being edited. */
  current: string;
  /** The theme's templates (sorted), `current` included even when the theme has no such file yet. */
  templates: string[];
  /** URL of the editor on a template (the app's templateHref). */
  href: (name: string) => string;
}

// Same rule as core's template paths (templates/<name>.json, up to 5 lowercase segments).
const TEMPLATE_PATH = /^templates\/((?:[a-z0-9][a-z0-9-]{0,63}\/){0,4}[a-z0-9][a-z0-9-]{0,63})\.json$/;

/** The theme's template names, from its manifest's files (nested ones as `dir/name`), sorted. */
export function templateNames(manifest: Pick<Manifest, "files">): string[] {
  const names: string[] = [];
  for (const file of Object.keys(manifest.files ?? {})) {
    const name = TEMPLATE_PATH.exec(file)?.[1];
    if (name) names.push(name);
  }
  return names.sort();
}

export interface TemplateTree {
  /** Template names at this level (full names), sorted. */
  templates: string[];
  /** Sub-folders (full paths), sorted. */
  folders: { path: string; tree: TemplateTree }[];
}

/** Template names as a tree of folders: `blog/archive/2026` is in folder `blog`, then `blog/archive`. */
export function templateTree(names: readonly string[]): TemplateTree {
  const root: TemplateTree = { templates: [], folders: [] };
  for (const name of [...names].sort()) {
    const parts = name.split("/");
    let node = root;
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      let folder = node.folders.find((f) => f.path === path);
      if (!folder) node.folders.push((folder = { path, tree: { templates: [], folders: [] } }));
      node = folder.tree;
    }
    node.templates.push(name);
  }
  const sort = (t: TemplateTree) => {
    t.folders.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    t.folders.forEach((f) => sort(f.tree));
  };
  sort(root);
  return root;
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/** `current` and `href`, provided by <PuckEditorFrame> (or passed to <TemplateSelector>). */
const SelectorDefaults = createContext<{ current?: string; href?: (name: string) => string }>({});

export function TemplateSelectorProvider({
  current,
  href,
  children,
}: {
  current: string;
  href: (name: string) => string;
  children: ReactNode;
}) {
  return <SelectorDefaults.Provider value={{ current, href }}>{children}</SelectorDefaults.Provider>;
}

interface Crumb {
  path: string;
  label: ReactNode;
}

interface NavValue {
  current: string;
  href: (name: string) => string;
  /** The open folders, root first ([] = the root level). */
  open: Crumb[];
  enter: (crumb: Crumb) => void;
}

const Nav = createContext<NavValue | null>(null);
/** The folder paths from the root to the level a node belongs to. */
const Level = createContext<readonly string[]>([]);

function useNav(name: string): NavValue {
  const nav = useContext(Nav);
  if (!nav) throw new Error(`${name} must be used inside <TemplateSelector>`);
  return nav;
}

const sameLevel = (level: readonly string[], open: readonly Crumb[]) =>
  level.length === open.length && level.every((p, i) => open[i].path === p);

// ---------------------------------------------------------------------------
// Icons (paths from Lucide, https://lucide.dev, ISC license)
// ---------------------------------------------------------------------------

function Icon({ children, className = "prt-icon" }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {children}
    </svg>
  );
}
const FileIcon = () => (
  <Icon>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </Icon>
);
const FolderIcon = () => (
  <Icon>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);
const ChevronRight = () => (
  <Icon className="prt-icon prt-trailing">
    <path d="m9 18 6-6-6-6" />
  </Icon>
);
const ChevronLeft = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
const ChevronsUpDown = () => (
  <Icon className="prt-icon prt-muted">
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </Icon>
);
const Check = () => (
  <Icon className="prt-icon prt-trailing prt-check">
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

// ---------------------------------------------------------------------------
// Styles (Puck's design tokens; one hoisted stylesheet)
// ---------------------------------------------------------------------------

const STYLES = `
.prt-trigger{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:var(--puck-space-2,8px);height:32px;max-width:100%;padding:0 var(--puck-space-2,8px);border-radius:var(--puck-radius-m,6px);font-family:var(--puck-font-family,inherit);font-size:var(--puck-font-size-xs,14px);color:var(--puck-color-text,#111);cursor:pointer;transition:background-color var(--puck-duration-fast,150ms)}
.prt-trigger:hover,.prt-trigger[data-state=open]{background:var(--puck-color-grey-11,#f5f5f5)}
.prt-trigger:focus-visible{outline:2px solid var(--puck-color-focus-ring,#3b82f6);outline-offset:1px}
.prt-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prt-dir{color:var(--puck-color-text-muted,#6b7280);font-weight:var(--puck-font-weight-regular,400)}
.prt-name{font-weight:var(--puck-font-weight-semibold,600)}
.prt-icon{flex:none;width:16px;height:16px}
.prt-muted{color:var(--puck-color-text-muted,#6b7280)}
.prt-content{box-sizing:border-box;width:280px;padding:var(--puck-space-1,4px);background:var(--puck-color-surface,#fff);color:var(--puck-color-text,#111);border:1px solid var(--puck-color-border-muted,#e5e7eb);border-radius:var(--puck-radius-l,8px);box-shadow:0 4px 16px rgb(0 0 0 / .08),0 1px 3px rgb(0 0 0 / .06);font-family:var(--puck-font-family,inherit);font-size:var(--puck-font-size-xs,14px);z-index:1000;transform-origin:var(--radix-popover-content-transform-origin)}
.prt-content[data-state=open]{animation:prt-in var(--puck-duration-fast,150ms) var(--puck-ease-entrance,ease-out)}
@keyframes prt-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.prt-content[data-state=open]{animation:none}.prt-trigger{transition:none}}
.prt-header{display:flex;align-items:center;gap:var(--puck-space-1,4px);min-height:32px;padding:0 var(--puck-space-1,4px) var(--puck-space-1,4px);margin-bottom:var(--puck-space-1,4px);border-bottom:1px solid var(--puck-color-border-muted,#e5e7eb)}
.prt-heading{padding:var(--puck-space-1,4px) var(--puck-space-2,8px);font-size:var(--puck-font-size-xxs,12px);font-weight:var(--puck-font-weight-medium,500);color:var(--puck-color-text-muted,#6b7280)}
.prt-back{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:var(--puck-radius-s,4px);color:var(--puck-color-text-muted,#6b7280);cursor:pointer}
.prt-back:hover{background:var(--puck-color-grey-11,#f5f5f5);color:var(--puck-color-text,#111)}
.prt-back:focus-visible,.prt-crumb:focus-visible{outline:2px solid var(--puck-color-focus-ring,#3b82f6)}
.prt-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:2px;min-width:0;font-size:var(--puck-font-size-xxs,12px);color:var(--puck-color-text-muted,#6b7280)}
.prt-crumb{all:unset;cursor:pointer;border-radius:var(--puck-radius-s,4px);padding:2px 4px}
.prt-crumb:hover{color:var(--puck-color-text,#111);background:var(--puck-color-grey-11,#f5f5f5)}
.prt-crumb[aria-current]{color:var(--puck-color-text,#111);font-weight:var(--puck-font-weight-medium,500);cursor:default;background:none}
.prt-list{max-height:360px;overflow-y:auto}
.prt-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:var(--puck-space-2,8px);width:100%;height:32px;padding:0 var(--puck-space-2,8px);border-radius:var(--puck-radius-m,6px);color:var(--puck-color-text,#111);cursor:pointer;user-select:none}
.prt-row .prt-icon:first-child{color:var(--puck-color-text-muted,#6b7280)}
.prt-row:hover,.prt-row:focus-visible{background:var(--puck-color-azure-11,#f3f6fb);outline:none}
.prt-row:focus-visible{box-shadow:inset 0 0 0 1px var(--puck-color-azure-08,#93c5fd)}
.prt-row[aria-current=page]{font-weight:var(--puck-font-weight-medium,500)}
.prt-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prt-trailing{margin-left:auto;color:var(--puck-color-text-muted,#6b7280)}
.prt-check{color:var(--puck-color-azure-04,#2563eb)}
.prt-empty{padding:var(--puck-space-3,12px) var(--puck-space-2,8px);color:var(--puck-color-text-muted,#6b7280);text-align:center}
`;

const Styles = () => (
  <style href="puck-remote-template-selector" precedence="default">
    {STYLES}
  </style>
);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** A template row: a link to the editor on that template. */
function TemplateItem({ name, label }: { name: string; label?: ReactNode }) {
  const nav = useNav("<TemplateSelector.Template>");
  const level = useContext(Level);
  if (!sameLevel(level, nav.open)) return null;
  const isCurrent = name === nav.current;
  return (
    <a className="prt-row" data-prt-row="" href={nav.href(name)} aria-current={isCurrent ? "page" : undefined}>
      <FileIcon />
      <span className="prt-label">{label ?? lastSegment(name)}</span>
      {isCurrent && <Check />}
    </a>
  );
}

/** A folder: a row at its parent's level; its children once opened. `path` identifies it. */
function FolderItem({ path, label, children }: { path: string; label?: ReactNode; children?: ReactNode }) {
  const nav = useNav("<TemplateSelector.Folder>");
  const level = useContext(Level);
  const shown = label ?? lastSegment(path);
  if (sameLevel(level, nav.open))
    return (
      <button type="button" className="prt-row" data-prt-row="" data-prt-folder="" onClick={() => nav.enter({ path, label: shown })}>
        <FolderIcon />
        <span className="prt-label">{shown}</span>
        <ChevronRight />
      </button>
    );
  // Inside this folder (or deeper): render its children at the next level.
  const inside = nav.open.length > level.length && nav.open[level.length].path === path && level.every((p, i) => nav.open[i].path === p);
  if (!inside) return null;
  return <Level.Provider value={[...level, path]}>{children}</Level.Provider>;
}

/** Renders a templateTree() as Template and Folder nodes (the default selector's contents). */
function AutoItems({ templates }: { templates: readonly string[] }) {
  return <TreeNodes tree={templateTree(templates)} />;
}

function TreeNodes({ tree }: { tree: TemplateTree }) {
  return (
    <>
      {tree.templates.map((name) => (
        <TemplateItem key={name} name={name} />
      ))}
      {tree.folders.map((f) => (
        <FolderItem key={f.path} path={f.path}>
          <TreeNodes tree={f.tree} />
        </FolderItem>
      ))}
    </>
  );
}

const rowsOf = (list: HTMLElement | null) => (list ? [...list.querySelectorAll<HTMLElement>("[data-prt-row]")] : []);

export interface TemplateSelectorProps {
  /** Templates and folders (<TemplateSelector.Template>, <TemplateSelector.Folder>, wrapped or not). */
  children?: ReactNode;
  /** The template being edited; default: the one <PuckEditorFrame> edits. */
  current?: string;
  /** URL of the editor on a template; default: <PuckEditorFrame>'s templateHref. */
  href?: (name: string) => string;
}

/** The header's template selector: a button opening a drill-down list of templates and folders. */
export function TemplateSelector(props: TemplateSelectorProps) {
  const defaults = useContext(SelectorDefaults);
  const current = props.current ?? defaults.current;
  const href = props.href ?? defaults.href;
  if (current === undefined || !href) throw new Error("<TemplateSelector> needs current and href (from <PuckEditorFrame templateHref> or its props)");
  const [isOpen, setIsOpen] = useState(false);
  const [open, setOpen] = useState<Crumb[]>([]);
  const [empty, setEmpty] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);

  // Focus the level's first row, and notice an empty folder.
  const showLevel = () => {
    const rows = rowsOf(list.current);
    setEmpty(rows.length === 0);
    rows[0]?.focus();
  };
  // A new level. (Opening is onOpenAutoFocus: Radix mounts the portal's content a render later.)
  useLayoutEffect(() => {
    if (list.current) showLevel();
  }, [open]);

  // Closing goes back to the root level for next time.
  useEffect(() => {
    if (!isOpen) setOpen([]);
  }, [isOpen]);

  const nav: NavValue = { current, href, open, enter: (crumb) => setOpen((o) => [...o, crumb]) };
  const back = () => setOpen((o) => o.slice(0, -1));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const rows = rowsOf(list.current);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return focus(at < 0 ? 0 : at + 1);
      case "ArrowUp":
        e.preventDefault();
        return focus(at < 0 ? rows.length - 1 : at - 1);
      case "Home":
        e.preventDefault();
        return focus(0);
      case "End":
        e.preventDefault();
        return focus(rows.length - 1);
      case "ArrowRight":
        if (at >= 0 && rows[at].hasAttribute("data-prt-folder")) {
          e.preventDefault();
          rows[at].click();
        }
        return;
      case "ArrowLeft":
      case "Backspace":
        if (open.length) {
          e.preventDefault();
          back();
        }
        return;
    }
  }

  const segments = current.split("/");
  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Styles />
      <Popover.Trigger className="prt-trigger" aria-label="Template" title={current}>
        <FileIcon />
        <span className="prt-path">
          {segments.slice(0, -1).map((dir, i) => (
            <span key={i} className="prt-dir">
              {dir} /{" "}
            </span>
          ))}
          <span className="prt-name">{segments[segments.length - 1]}</span>
        </span>
        <ChevronsUpDown />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="prt-content"
          align="start"
          sideOffset={6}
          // Focus goes to the first row instead.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            showLevel();
          }}
          onKeyDown={onKeyDown}
        >
          {open.length ? (
            <div className="prt-header">
              <button type="button" className="prt-back" aria-label="Back" onClick={back}>
                <ChevronLeft />
              </button>
              <nav className="prt-crumbs" aria-label="Folders">
                <button type="button" className="prt-crumb" onClick={() => setOpen([])}>
                  Templates
                </button>
                {open.map((crumb, i) => (
                  <Fragment key={crumb.path}>
                    <span aria-hidden>/</span>
                    {i === open.length - 1 ? (
                      <span className="prt-crumb" aria-current="location">
                        {crumb.label}
                      </span>
                    ) : (
                      <button type="button" className="prt-crumb" onClick={() => setOpen((o) => o.slice(0, i + 1))}>
                        {crumb.label}
                      </button>
                    )}
                  </Fragment>
                ))}
              </nav>
            </div>
          ) : (
            <div className="prt-heading">Templates</div>
          )}
          <div className="prt-list" ref={list}>
            <Nav.Provider value={nav}>
              <Level.Provider value={[]}>{props.children}</Level.Provider>
            </Nav.Provider>
          </div>
          {empty && <div className="prt-empty">No templates</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

TemplateSelector.Template = TemplateItem;
TemplateSelector.Folder = FolderItem;
TemplateSelector.Auto = AutoItems;

/** The default switcher: every template of the theme, folders as in templates/. */
export function TemplateSwitcher({ current, templates, href }: TemplateSwitcherProps) {
  return (
    <TemplateSelector current={current} href={href}>
      <TemplateSelector.Auto templates={templates} />
    </TemplateSelector>
  );
}
