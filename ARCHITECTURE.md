# Architecture

The architecture documentation moved to the docs site (`pnpm docs:dev`, http://localhost:3200):

| Former section | Now in |
|---|---|
| 1. Verified environment, isolated-vm and React findings | `apps/docs/content/docs/internals/puck-findings.mdx`, `isolate-runtime.mdx`, `performance.mdx` |
| 2. Puck findings | `internals/puck-findings.mdx` |
| 3. Deviations D1–D7 | Decisions D-0016 to D-0023 in `.claude/merged/2026-10/feat-poc-sandboxed-blocks.md` |
| 4. Build-time metadata extraction | `internals/build-pipeline.mdx` |
| 5. Isolate lifecycle | `concepts/blocks-and-isolate.mdx`, `internals/isolate-runtime.mdx` |
| 6. Slot-marker scheme | `concepts/slots.mdx`, `internals/slot-swap.mdx` |
| 7. Keeping resolveData out of saved pages | `concepts/editor.mdx`, `internals/editor-lifecycle.mdx` |
| 8. How the editor renders blocks | `concepts/editor.mdx` (server rendering since M2) |
| 9. Known limitations | `internals/known-gaps.mdx` |
| 10. Host plugins | `concepts/adapters.mdx`, `guides/writing-adapters.mdx`, `internals/host-source.mdx` |
| 11. Packaging | `internals/packaging.mdx` |
| 12. V1 foundations | `reference/config.mdx`, `internals/auth-and-csrf.mdx`, `internals/artifact-loader.mdx` |
| 13. Isolation and threat model | `concepts/trust-model.mdx`, `internals/worker-pool.mdx`, `reference/worker-protocol.mdx` |

Every decision, with its provenance and rationale, is in `.claude/` (rendered under **Decisions**
in the docs, queried with `pnpm adr`).
