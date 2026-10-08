# Architecture

The architecture documentation moved to the docs site (`pnpm docs:dev`, http://localhost:3200),
mostly under the **Internal** section. Paths below are relative to `apps/docs/content/docs/`.

| Former section | Now in |
|---|---|
| 1. Verified environment, isolated-vm and React findings | `internal/quality/puck-findings.mdx`, `internal/architecture/isolate-runtime.mdx`, `internal/quality/performance.mdx` |
| 2. Puck findings | `internal/quality/puck-findings.mdx` |
| 3. Deviations D1–D7 | Decisions D-0016 to D-0023 in `.claude/merged/2026-10/feat-poc-sandboxed-blocks.md` |
| 4. Build-time metadata extraction | `internal/architecture/build-pipeline.mdx` |
| 5. Isolate lifecycle | `(framework)/concepts/blocks-and-isolate.mdx`, `internal/architecture/isolate-runtime.mdx` |
| 6. Slot-marker scheme | `(framework)/concepts/slots.mdx`, `internal/architecture/slot-swap.mdx` |
| 7. Keeping resolveData out of saved pages | `(framework)/concepts/editor.mdx`, `internal/architecture/editor-lifecycle.mdx` |
| 8. How the editor renders blocks | `(framework)/concepts/editor.mdx` (server rendering since M2) |
| 9. Known limitations | `internal/quality/known-gaps.mdx` |
| 10. Host plugins | `(framework)/concepts/adapters.mdx`, `core/adapters/*`, `internal/architecture/host-source.mdx` |
| 11. Packaging | `internal/architecture/packaging.mdx` |
| 12. V1 foundations | `(framework)/configuration.mdx`, `internal/architecture/auth-and-csrf.mdx`, `internal/architecture/artifact-loader.mdx` |
| 13. Isolation and threat model | `internal/architecture/threat-model.mdx`, `internal/architecture/worker-pool.mdx`, `internal/architecture/worker-protocol.mdx` |

Every decision, with its provenance and rationale, is in `.claude/` (rendered under
`/docs/internal/decisions`, queried with `pnpm adr`).
