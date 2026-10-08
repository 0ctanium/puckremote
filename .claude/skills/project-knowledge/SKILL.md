---
name: project-knowledge
description: Find anything about puck-remote fast — which doc page explains a topic, which source file implements it, which test covers it, and which decisions constrain it. Use before planning or answering any question about the project.
---

# Finding information in puck-remote

Always check what was already decided and documented before proposing anything.

## 1. Decisions (why things are the way they are)

```bash
pnpm adr search <term>          # titles, tags, ADR bodies
pnpm adr list --tag <tag>       # tags: security, data, editor, packaging, process, roadmap, …
pnpm adr list --needs-review    # agent-made choices a human has not confirmed yet
pnpm adr show D-0080            # one decision (status, provenance, supersede links)
pnpm adr list --adrs            # every ADR (unit of work)
```

The rationale is in the ADR file (`.claude/branches/**` or `.claude/merged/**`), section
"Decision Record". A `superseded` decision is history: follow `superseded_by`. A `needs-review`
decision is not confirmed; mention it to the human if your work depends on it.

## 2. Docs (how things work)

`apps/docs/content/docs/` is the source of truth for behavior. It has five roots
(sidebar dropdown):

| Question | Root / folder |
|---|---|
| What is it, install, run the example | `(framework)/index`, `installation`, `quick-start` |
| Mental model, trust model | `(framework)/concepts/` |
| Next.js setup and API | `(framework)/next-js/` |
| How to do X (themes, typing, other frameworks, deploy) | `(framework)/guides/` |
| Config options, HTTP API, headers, env vars | `(framework)/configuration`, `http-api`, `security-headers`, `environment` |
| Engine API, entry points, adapters (artifacts, pages, data, cache, auth, renderer) | `core/`, `core/adapters/` |
| CLI commands and output | `cli/` |
| Block API, fields, queries, ctx, host contracts, formats | `sdk/` |
| How it works inside, with source paths | `internal/architecture/` |
| Tests, performance, Puck findings, gaps | `internal/quality/` |
| Workflow, rules, docs conventions, enforcement | `internal/contributing/` |
| Decisions | `.claude/` (rendered at `/docs/internal/decisions`) |

```bash
grep -ril "<term>" apps/docs/content/docs
```

Each `internal/architecture` page ends with `<Source path="…">` lines naming the implementing files.

## 3. Code map

| Concern | Files |
|---|---|
| Config + defaults | `packages/core/src/server/config.ts` |
| Entry points, HTTP API | `packages/core/src/core.ts` |
| Public render | `server/public-render.ts`, `page-tree.ts`, `puck-rsc.tsx`, `react/PuckRemotePage.tsx` |
| Isolate / workers | `server/runtime/{types,in-process,worker-pool,render-worker}.ts` |
| Data | `server/query/{resolver,host-source,http-source,params,cache}.ts` |
| Surfaces, CSP, auth | `server/surface.ts`, `server/auth.ts`, `packages/next/src/proxy.ts` |
| Artifacts | `server/artifact-loader.ts`, `server/static-files.ts`, `packages/artifacts-fs` |
| Editor | `packages/core/src/editor/*` |
| Theme API, contracts | `packages/sdk/src/{index,types,host,runtime}.ts` |
| CLI | `packages/cli/src/{build,validate,publish}.ts` |

## 4. Tests

The test map is `apps/docs/content/docs/internal/quality/testing.mdx`. Suites live in
`packages/core/test/*` and `packages/cli/test/*`.
