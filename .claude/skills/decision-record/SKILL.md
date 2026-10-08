---
name: decision-record
description: Create and maintain ADRs and decision entries in puck-remote — when to create an ADR, how to record each approved decision with the right provenance, how to supersede, review and archive. Use whenever a plan is approved or a decision is made.
---

# Recording decisions

Full guide: `.claude/ADR-SYSTEM-GUIDE.md`. Never edit `.claude/adr-index.toml` by hand.

## At the start of a unit of work

```bash
git checkout -b <feat|chore|docs|fix>/<slug>
pnpm adr new <type>/<slug> --title "Short title" --tags a,b [--template feature|chore|research]
```

Fill in the ADR (`.claude/branches/<type>/<slug>.md`): frontmatter `title`/`description`, Meta
(set "Approved by"), Problem Statement.

## For every approved choice

```bash
pnpm adr decision <type>/<slug> --title "One-line decision" --provenance <p> --tags a,b
```

| Provenance | Use when |
|---|---|
| `user` | The human stated it or chose it when asked |
| `user-approved-plan` | You proposed it in a plan the human approved |
| `agent-unreviewed` | You chose it without approval (rule broken; record it honestly; becomes `needs-review`) |

Then add the options considered, rationale and trade-offs under "Decision Record" in the ADR.
Titles state the decision itself ("Cache adapter results for 30 s"), not the topic.

## Changing a past decision

Never edit or delete it. Record a new decision with `--supersedes D-NNNN` (only after approval).
The old one becomes `superseded`.

## Reviews and archiving (humans)

```bash
pnpm adr review D-NNNN --status accepted|rejected --note "…"
pnpm adr archive <type>/<slug>      # after a human merged the branch
```

## Before committing

```bash
pnpm adr check
```

Also complete Investigation Notes, Challenges, QA and Outcome sections as the work progresses.
