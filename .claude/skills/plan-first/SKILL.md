---
name: plan-first
description: Mandatory before any change in puck-remote. Explains what counts as a decision (almost everything), how to write a plan that lists every choice for human approval, and what to do when a new choice appears mid-implementation.
---

# Plan first: humans decide, agents propose

Rule (D-0094): an AI agent never makes a decision on its own. Every choice, even minor, is made
or validated by a human through an approved plan.

## What counts as a decision

Anything where a reasonable person could choose differently:

- architecture, data flow, module boundaries, security trade-offs;
- public names (functions, options, types, files, packages, CLI flags, env vars);
- default values, limits, timeouts, sizes;
- adding, removing or upgrading a dependency;
- file and folder layout; where code lives;
- error messages and user-facing wording; docs structure;
- test strategy (what is tested, how);
- behavior changes, even "bug fixes" that change observable behavior.

Not decisions: mechanically following an already-recorded decision or an explicit instruction,
and pure reading or investigation.

## How to plan

1. Investigate first (skill `project-knowledge`): read the relevant docs pages and decisions.
2. Enter plan mode. The plan must include:
   - **Context**: why the change is needed;
   - **Choices**: a numbered list of every decision, each with the options considered and a
     recommendation; mark which existing decisions (D-NNNN) it relies on or would supersede;
   - **Files**: what will be created or changed, including docs pages;
   - **Verification**: how it will be tested.
3. Ask questions (AskUserQuestion) when a choice has no clear recommendation.
4. Call ExitPlanMode. Only after approval may you edit files (a hook enforces this).

## When something new comes up mid-implementation

Stop. Do not pick an option. Ask with AskUserQuestion or propose an updated plan. Record the answer
as a decision (`user` if the human chose it, `user-approved-plan` if they approved your proposal).

## If you already chose something without approval

Say so plainly to the human and record it as `agent-unreviewed` (status `needs-review`).
