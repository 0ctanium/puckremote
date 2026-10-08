---
title: "Docs (Fumadocs), ADR decision system, agent rules and enforcement"
description: Full Fumadocs documentation, an ADR/decision log with provenance, skills for agents, and hooks/CI that enforce plan approval, decision logging and docs updates. Also records roadmap decisions not yet implemented.
---

# Branch ADR: docs/fumadocs-and-adr-system

## Meta
- **Branch**: docs/fumadocs-and-adr-system
- **Type**: docs
- **Created**: 2026-10-08
- **Status**: Active
- **Author**: Claude
- **Approved by**: project owner (answers to three questions plus the approved plan)
- **PR**: (not yet created; the repository has no remote)

## Problem Statement
### Context
Project knowledge was spread over README.md, ARCHITECTURE.md and a long conversation. The owner
asked for:
- complete Fumadocs documentation, including internals;
- every decision stored in the project;
- skills that help agents find information;
- rules that stop agents from deciding anything without human validation.

### Goals
- A browsable, searchable docs site.
- A decision log with IDs and provenance.
- Enforcement through instructions, Claude Code hooks, a pre-commit hook and CI.

### Non-Goals
Changing product behaviour.

## Decisions
<!-- decisions:start (managed by `pnpm adr decision`; one row per indexed decision) -->
| ID | Decision | Provenance | Status |
|---|---|---|---|
| D-0092 | Documentation site built with Fumadocs (apps/docs), covering usage, reference and internals | user | accepted |
| D-0093 | Decision log follows the owner's ADR system guide (branch ADRs, TOML index, templates, helper, archive) plus decision IDs and provenance | user | accepted |
| D-0094 | AI agents never decide alone: every choice, even minor, is made or validated by a human via an approved plan | user | accepted |
| D-0095 | Enforcement: instructions + Claude Code hooks (plan gate, docs/ADR stop check) + git pre-commit + CI check | user | accepted |
| D-0096 | Backfill every past decision with provenance; agent-made ones flagged needs-review | user | accepted |
| D-0097 | Branch per unit of work (type/slug) with its ADR; a human merges to main; ADR archived after merge | user-approved-plan | accepted |
| D-0098 | README becomes a quick start + link; ARCHITECTURE.md becomes a pointer; content moves into the docs | user-approved-plan | accepted |
| D-0099 | ADRs are rendered in the docs straight from .claude/ (single source, no copies) | user-approved-plan | accepted |
| D-0100 | Hook blocks write-like Bash commands without an approved plan using a documented heuristic; SKIP_DOCS_CHECK is human-only | user-approved-plan | accepted |
<!-- decisions:end -->

## Decision Record
### Options Considered
- **Where decisions live.** The owner provided the ADR system guide: branch ADRs, a TOML index,
  templates, a helper, archiving. Adopted, with decision IDs and provenance added.
- **Enforcement level.** The options were instructions only, instructions plus CI, or instructions
  plus automated checks including hooks. The owner chose instructions plus automated checks.
- **Backfill.** All past decisions are recorded with provenance; agent-made ones are flagged
  `needs-review`.

### Rationale
Agents lose context between sessions. A machine-queryable index plus docs rendered from the same
files gives one source of truth. Hooks make the plan rule hard to bypass by accident.

### Trade-offs Accepted
- The Bash write detection in the hook is a heuristic.
- `SKIP_DOCS_CHECK` exists for humans only.

## Roadmap decisions recorded here (not yet implemented)
These were decided during V1 planning and are kept here so M3–M5 plans start from them: D-0068,
D-0069, D-0070, D-0071, D-0072, D-0073, D-0074, D-0075 (indexed under `feat/m1-foundations`).

## Implementation
`.claude/` (guide, index, helper, templates, ADRs, skills, hooks), `apps/docs` (Fumadocs),
`CLAUDE.md`, `scripts/check-docs-adr.mjs`, `.githooks/`, CI steps.

## Investigation Notes
(to be completed during implementation)

## Challenges & Solutions
(to be completed during implementation)

## Impact Assessment
Every future change requires a plan, an ADR entry and a docs update.

## Quality Assurance
See the plan's Verification section.

## Outcome & Lessons
(to be completed before merge)

## Tags
docs adr process agents enforcement
