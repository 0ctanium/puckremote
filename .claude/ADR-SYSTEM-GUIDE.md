---
title: ADR system guide
description: How decisions are recorded in puck-remote, and the rules every contributor (human or AI) follows.
---

# ADR system guide (puck-remote)

Adapted from the project owner's "Claude ADR System Guide". This copy is the authority for this
repository. It adds three things to the original: **decision IDs**, **provenance**, and the
**human-approval rule**.

## The non-negotiable rule

> **AI agents never make decisions on their own.** Every choice, however minor (architecture, API
> or option names, default values, dependencies, file layout, error wording, test strategy), is
> proposed to a human, normally in plan mode, and only acted on once the plan is approved. If a
> new choice appears during implementation, the agent **stops** and asks (AskUserQuestion, or a new
> plan). Every approved choice is recorded here.

A decision that an agent made without approval anyway is recorded with provenance
`agent-unreviewed` and status `needs-review`, so a human can confirm or reject it with
`pnpm adr review`.

## Key principles

1. **Every unit of work (branch) gets an ADR.** No decision is too small to record.
2. **Every decision gets a global ID** (`D-0001`, …) in `adr-index.toml`. It is indexed with its
   ADR, date, provenance, status, tags and supersede links, so "everything decided about X" is one
   query away.
3. **Structured for AI.** There is a predictable template, a TOML index, cross-references and
   tags.
4. **Context is preserved.** Each ADR records options, rationale, trade-offs, investigation notes
   and lessons.
5. **Branching strategy integration.** ADRs live in `branches/<type>/` while work is in progress,
   and are archived to `merged/YYYY-MM/` after a human merges.
6. **Decisions are never rewritten.** A changed decision gets a new ID that `supersedes` the old
   one. The old one becomes `superseded`, with `superseded_by` pointing to the new one.

## Directory structure

```
.claude/
├── ADR-SYSTEM-GUIDE.md      this guide
├── adr-index.toml           master index (machine-managed through `pnpm adr`; comments are not kept)
├── adr-helper.mjs           the `pnpm adr` CLI
├── templates/               branch-adr.md, feature.md, chore.md, research.md
├── branches/<type>/<slug>.md          ADRs for in-progress work (feat | chore | docs | fix)
└── merged/<YYYY-MM>/<type>-<slug>.md  archived ADRs
```

The docs site (`apps/docs`) renders these files directly under **Decisions**. Every ADR therefore
starts with YAML frontmatter (`title`, `description`).

## Provenance values

| provenance | Meaning | Initial status |
|---|---|---|
| `user` | The human stated it, in their own words or by answering a question | `accepted` |
| `user-approved-plan` | An agent proposed it in a plan; the human approved the plan | `accepted` |
| `agent-unreviewed` | An agent chose it without explicit approval. This breaks the rule above, but is recorded honestly | `needs-review` |

Statuses: `accepted`, `needs-review`, `superseded`, `rejected`.

## Workflow

1. **Plan.** In plan mode, list every choice explicitly (see the `plan-first` skill) and get
   approval.
2. **Branch and ADR.** Run `git checkout -b <type>/<slug>`, then
   `pnpm adr new <type>/<slug> --title "…" --tags a,b`.
3. **Record decisions.** For each approved choice, run
   `pnpm adr decision <type>/<slug> --title "…" --provenance user-approved-plan --tags …`. Then
   write the rationale in the ADR's Decision Record section.
4. **Implement**, and **update the docs** (`apps/docs/content/docs/**`) in the same change.
5. **Check.** Run `pnpm adr check`, then `pnpm test`, then `pnpm docs:build`. The pre-commit hook
   runs `scripts/check-docs-adr.mjs`.
6. **Merge.** A human merges to `main`. Then run `pnpm adr archive <type>/<slug>`.

## CLI reference (`pnpm adr …`)

| Command | Does |
|---|---|
| `new <type>/<slug> --title T [--tags a,b] [--template feature\|chore\|research]` | Creates the ADR from a template and indexes it |
| `decision <adr> --title T --provenance P [--tags a,b] [--supersedes D-0001]` | Assigns the next decision ID, indexes it, and adds a row to the ADR's decisions table |
| `review <D-id> --status accepted\|rejected [--note …]` | A human confirms or rejects a `needs-review` decision |
| `search <term>` | Searches decision titles and tags, ADR titles and descriptions, and ADR bodies |
| `list [--needs-review] [--active] [--tag t] [--adr a]` | Lists decisions |
| `show <D-id \| adr>` | Prints one decision or one ADR entry |
| `archive <adr>` | Moves the ADR to `merged/YYYY-MM/` and marks it merged |
| `check` | Checks consistency (files ↔ index, IDs, provenance, supersede links, decisions tables) |

## Template structure

See `templates/branch-adr.md`. The sections are Meta, Problem Statement, **Decisions** (the
indexed table, between the `decisions:start` and `decisions:end` markers), Decision Record
(options, rationale, trade-offs per decision), Implementation, Investigation Notes, Challenges and
Solutions, Impact Assessment, Quality Assurance, Outcome and Lessons, and Tags.

## Avoiding pitfalls

- **Don't edit `adr-index.toml` by hand.** Use the CLI; it keeps IDs and tables in sync. If you
  must edit it, run `pnpm adr check` afterwards.
- **Outdated ADRs are worse than none.** Update the ADR while you work, not only at the end.
- **Search before deciding.** Run `pnpm adr search <topic>`. A past decision may already cover the
  question; re-litigating it needs a superseding decision approved by a human.
