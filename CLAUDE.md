# puck-remote: instructions for AI agents

Sandboxed React blocks for Puck. Read this file fully before doing anything.

## Non-negotiable rules

1. **No decision without human approval.** You never decide on your own. Every choice, even a
   minor one, is made or validated by a human through an approved plan. That includes
   architecture, API, option and type names, default values, limits, dependencies and versions,
   file layout, error messages, test strategy, docs structure and wording. Propose changes in plan
   mode and list every choice explicitly (skill `plan-first`); act only after ExitPlanMode is
   approved. If a new choice appears during implementation, **stop and ask** (AskUserQuestion or a
   new plan). Never pick the "obvious" option silently.
2. **Record every decision.** Each approved choice gets an ID with
   `pnpm adr decision <adr> --title "…" --provenance user|user-approved-plan|agent-unreviewed`, in
   the ADR of the current branch (skill `decision-record`). Write the options and rationale in the
   ADR. Never edit or delete past decisions: supersede them (`--supersedes D-NNNN`). If you made a
   choice without approval, record it honestly as `agent-unreviewed` and tell the human.
3. **Update the docs in the same change.** Code changes come with updates to
   `apps/docs/content/docs/**` (skill `docs-update`). `pnpm docs:build` must pass.
4. **Look before you work.** Search the docs and the decision log first (skill
   `project-knowledge`): `pnpm adr search <term>`, `grep -ri <term> apps/docs/content`.
5. **Humans merge.** Work on a `<type>/<slug>` branch (`feat|chore|docs|fix`) with its ADR
   (`pnpm adr new`). Never merge to `main`, never push without being asked. Never set
   `SKIP_DOCS_CHECK`; it is for humans only.

Hooks enforce parts of this: edits and write-like shell commands are blocked until a plan is
approved in the session, and a session cannot end with code changes lacking docs and ADR changes.

## Environment

- Native **arm64 Node 26** is required. Prepend it to PATH in every shell command:
  `export PATH=/Users/benjamin/.local/share/fnm/node-versions/v26.10.0/installation/bin:$PATH`
  (the default `node` is x64 under Rosetta and cannot load isolated-vm).
- pnpm 12. Scripts already set `NODE_OPTIONS=--no-node-snapshot`.

## Commands

| Task | Command |
|---|---|
| Build packages | `pnpm build` |
| Tests (builds first) | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Package lint | `pnpm lint:pkg` |
| Publish example theme | `pnpm --filter theme release` |
| Mock API (4010) | `pnpm --filter mock-api start` |
| Host app (3100) | `pnpm --filter host dev` (site `localhost:3100`, editor `editor.localhost:3100/editor`) |
| Docs (3200) | `pnpm docs:dev`, `pnpm docs:build` |
| Decisions | `pnpm adr new | decision | review | search | list | show | archive | check` |
| Docs/ADR check | `node scripts/check-docs-adr.mjs` |

Stop dev servers by port (`lsof -ti tcp:3100 | xargs kill -9`): orphaned `next-server`
processes have served stale builds before.

## Where things are

- `packages/sdk` (theme API + `/host` contracts), `packages/cli`, `packages/core` (engine),
  `packages/next` (bindings), `packages/{source-mock,pages-fs,artifacts-fs}` (adapters).
- `apps/host` (example app), `apps/docs` (Fumadocs), `examples/theme`, `mock/api-server`.
- `.claude/`: decision records (`ADR-SYSTEM-GUIDE.md`, `adr-index.toml`, `branches/`, `merged/`),
  skills, hooks.
- The docs map from code to pages: `apps/docs/content/docs/contributing/docs.mdx`.
