---
title: "Template switcher in the editor header"
description: "A Shopify-like dropdown in the editor header to move between a theme's templates (nested ones included), replaceable by apps"
---

# Branch ADR: feat/template-switcher

## Meta
- **Branch**: feat/template-switcher
- **Type**: feat
- **Created**: 2026-10-13
- **Status**: Active
- **Author**: Claude
- **Approved by**: Octanium (plan approved 2026-10-14; D-0632 answered during implementation)
- **PR**: (not yet created)

## Problem Statement
### Context
`<PuckEditorFrame>` showed the template name as a static header title. Editors had to edit the URL to open another template.

### Goals
- A dropdown in place of the title, like Shopify's theme editor, listing the theme's templates, nested ones (`templates/blog/post.json`) included.
- Navigation through the existing `?previewPath=` (D-0551, D-0612).
- A replaceable UI so apps apply their own logic (e.g. Shopify-style allowed template names).

### Non-Goals
- A built-in allow-list or "create template" entries (apps do this with their own switcher).
- Unsaved-changes logic in the frame (the app owns the "dirty" state).

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0620 | Template switcher renders in Puck's title slot (passed as headerTitle with a cast; a test pins it) | user | accepted |
| D-0621 | Template list comes from payload.manifest.files via templateNames(manifest) in @puck-remote/editor/frame (own regex copy, tested against core's) | user | accepted |
| D-0622 | Navigation by ?previewPath=: PuckEditorFrame prop templateHref(name) => string; without it the header keeps the static title | user | accepted |
| D-0623 | Modular UI: templateSwitcher?: ComponentType<TemplateSwitcherProps> \| false; TemplateSwitcherProps { current, templates, href }; default TemplateSwitcher exported; templates always includes current; no built-in allow-list | user | accepted |
| D-0624 | An explicit headerTitle string wins over the switcher | user-approved-plan | accepted |
| D-0625 | Default switcher is a native select: root templates first, nested in optgroup '<dir>/' labelled by last segment; change calls location.assign(href(name)) | user-approved-plan | superseded by D-0643 |
| D-0626 | Unsaved changes: examples add a beforeunload warning while dirty; no confirm logic in the frame | user-approved-plan | accepted |
| D-0627 | Example app templateHref: /editor?previewPath=<'/' for home, else /<name>>, keeping ?theme= | user-approved-plan | accepted |
| D-0628 | Payload plugin option previewPath?: (name) => string, inverse of template; default defaultPreviewPath (home -> '/', else '/<name>'); EditorClient builds templateHref from the view URL keeping theme | user-approved-plan | accepted |
| D-0629 | Example theme gets a nested templates/blog/post.json demo | user-approved-plan | accepted |
| D-0630 | Work on feat/template-switcher branched from feat/payload HEAD, carrying its uncommitted changes untouched; own ADR | user-approved-plan | accepted |
| D-0631 | Tests: templateNames (nested, ignore others, sorted, regex parity with core), groupTemplates order, server render of the header showing the select | user-approved-plan | superseded by D-0644 |
| D-0632 | Payload EditorView precomputes templatePaths: Record<name, previewPath> (theme templates + current) for EditorClient; templateNameOf newly exported from @puck-remote/core | user | accepted |
| D-0633 | Selector popover uses @radix-ui/react-popover 1.2.0 (exact pin, the version Puck resolves) as a dependency of @puck-remote/editor | user | accepted |
| D-0634 | No search field: the selector is a list with keyboard navigation | user | accepted |
| D-0635 | Composable API: TemplateSelector with TemplateSelector.Template { name, label? } and TemplateSelector.Folder { path, label?, children }; level context so nodes may be wrapped | user-approved-plan | accepted |
| D-0636 | PuckEditorFrame provides current and href to TemplateSelector through context; TemplateSelector props current/href override it | user-approved-plan | accepted |
| D-0637 | Default tree: templateTree(names) -> { templates, folders: { path, tree }[] }; TemplateSelector.Auto renders it; TemplateSwitcher = TemplateSelector + Auto; templateSwitcher prop and TemplateSwitcherProps unchanged | user-approved-plan | accepted |
| D-0638 | Popover content: 280px, start-aligned, 6px offset, 360px max list height, Puck surface/border-muted/radius-l, soft shadcn shadow, 150ms fade+scale off with reduced motion; rows 32px with azure-11 hover/focus, templates as links with check + aria-current, folders as buttons with chevron | user-approved-plan | accepted |
| D-0639 | Shopify-like drill-down: folder click shows its contents with a back button and clickable breadcrumb 'Templates / …'; opens at the root (label 'Templates'); empty folder shows 'No templates' | user | accepted |
| D-0640 | Keyboard: arrows/Home/End move focus; ArrowRight/Enter open a folder; ArrowLeft/Backspace go back; Escape closes; focus first row on open and level change | user-approved-plan | accepted |
| D-0641 | Styles: one React 19 hoisted <style href='puck-remote-template-selector' precedence='default'>, class prefix prt-, inline Lucide icon paths (ISC, credited) | user-approved-plan | accepted |
| D-0642 | Selector lives in packages/editor/src/template-selector.tsx, re-exported from @puck-remote/editor/frame | user-approved-plan | accepted |
| D-0643 | groupTemplates removed and the native select UI replaced by the selector (trigger: ghost button, file icon, muted directory / semibold name, chevrons-up-down; Puck tokens) | user | accepted |
| D-0644 | Tests: happy-dom 20.14.5 devDependency (per-file environment); templateTree units, SSR trigger in Puck's title slot, interaction tests with react-dom/client + act (drill-down, breadcrumb, keyboard, aria-current, custom wrapped tree) | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- D-0620 placement: Puck's title slot (cast) / headerActions (typed, but on the right) / our own header (full control, more code).
- D-0621 list source: manifest.files (no core or protocol change) / a new EditorPayload.templates.
- D-0622 navigation: templateHref with ?previewPath= (user) / a ?template= param (proposed, rejected: previewPath is the template path) / an onTemplateChange callback.
- D-0623 restriction: a modular UI (user) / an allowed list plus "create missing" / filter-only.
- D-0625 default UI: a native select / a custom popover with links.
- D-0632 Payload: precompute a map with core's templateNameOf exported / a map with a local regex / drop the previewPath option.
- D-0633 popover: Radix Popover (deduped with Puck's) / hand-built.
- D-0634 content: list only / search + list.
- D-0640 nesting (user): Shopify-like drill-down with breadcrumb / sections per directory / indented tree.
- D-0643 trigger (user): ghost button with full path / outlined button.

### Rationale
- The title slot keeps Puck's native header where the title already is. The test pins Puck's runtime behavior.
- manifest.files already lists every template, so the payload and the protocol stay unchanged.
- The select is accessible and needs no dependency. The switcher component covers custom needs.
- The plugin's previewPath function can't cross the server/client boundary, so the server computes the paths.

### Trade-offs Accepted
- The headerTitle cast depends on untyped Puck behavior (0.23); an upgrade could break it (caught by the test).
- The editor package keeps its own copy of the template-path regex (a parity test with core's guards it).
- (Superseded with D-0625) The native select showed only the last segment; the selector's trigger shows the full path.
- The level context renders each node only at its level, so a level's emptiness is detected from the DOM (after render) rather than from the tree.

## Implementation
### Public API / config changes
- `@puck-remote/editor/frame`: `PuckEditorFrame` props `templateHref`, `templateSwitcher`; exports `TemplateSelector` (`.Template`, `.Folder`, `.Auto`), `TemplateSelectorProps`, `TemplateSwitcher`, `TemplateSwitcherProps`, `templateNames`, `templateTree`, `TemplateTree` (`groupTemplates` removed, D-0643).
- `@puck-remote/editor`: dependency `@radix-ui/react-popover` 1.2.0, devDependency `happy-dom` 20.14.5.
- `@puck-remote/core`: exports `templateNameOf`.
- `@puck-remote/payload/plugin`: option `previewPath`, export `defaultPreviewPath`. EditorClient props `editorUrlBase`, `themeParam`, `templatePaths`.
- Example app: `ClientEditor` prop `themeParam`; `beforeunload` while dirty (both examples).
- Example theme: `templates/blog/post.json`.

### Docs pages touched
- (framework)/concepts/editor.mdx (Switching templates)
- (framework)/guides/editor-app.mdx (Template switcher, props table)
- core/adapters/payload.mdx (previewPath option, editor view)
- core/index.mdx (nested templates, templateNameOf)
- internal/architecture/editor-lifecycle.mdx (the headerTitle cast, Payload map)
- internal/quality/testing.mdx (new test row)

## Investigation Notes
[Research, experiments, dead ends]

## Challenges & Solutions
[Technical and process challenges encountered]

## Impact Assessment
[Performance, user, maintenance, security]

## Quality Assurance
- `packages/editor/test/template-selector.test.tsx` (replaces template-switcher.test.tsx): 11 tests, happy-dom for the DOM ones. They caught a real bug: Radix mounts the portal's content one render after opening, so the first-row focus moved to onOpenAutoFocus.
- `pnpm typecheck`, `pnpm test`, `pnpm lint:pkg` and `pnpm docs:build` pass.
- Browser (selector): trigger `blog / post`; popover at the root (home, search, blog); End + → opens blog with breadcrumb `Templates / blog`, check on post, focus on post; ← back; Enter on home loads `?previewPath=%2F`. No console error from opening or closing the selector. Puck has no dark tokens, so only light mode applies.
- Full suite: one run had a flaky CLI `dev` watcher test (packages/core cli-api, fs.watch timing); it passed alone and in a full core rerun (153 passed).
- Browser (first version): the dropdown lists home, search and blog/ › post; choosing post loads `?previewPath=%2Fblog%2Fpost` with the nested template in the canvas; `beforeunload` is prevented only after an edit.
- Payload example: not verified in the browser (the pane's Payload session was a user without theme access; it was not signed out).

## Outcome & Lessons
[Final results and lessons learned]

## Tags
editor templates
