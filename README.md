# puck-remote

Sandboxed React blocks for [Puck](https://puckeditor.com). Untrusted theme developers write blocks
with `defineBlock(...)`; a CLI builds them into a versioned artifact; the host renders them in the
Puck editor and on a server-rendered public site, running theme code only inside `isolated-vm`,
inside permission-restricted worker processes.

**Documentation:** run `pnpm docs:dev` and open http://localhost:3200 (sources in
[`apps/docs/content/docs`](apps/docs/content/docs)). Sections: **Framework** (installation,
concepts, Next.js, guides, configuration), **Core** (engine and adapters), **CLI**, **SDK**, and
**Internal** (architecture, quality, contributing, every project decision).

## Quick start

Requires native **arm64 Node 26** (or Node 24+ on Linux) and **pnpm 12**.

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm --filter theme release
```

```bash
pnpm --filter mock-api start
```

```bash
pnpm --filter host dev
```

- Public site: http://localhost:3100/
- Admin (editor frame): http://admin.localhost:3100/editor
- Editor (embedded only): http://127.0.0.1:3100/

```bash
pnpm test
```

## Contributing

Every change follows a plan approved by a human, is recorded as a decision (`pnpm adr`), and
updates the docs in the same change. Read [`CLAUDE.md`](CLAUDE.md) and the
[Contributing section](apps/docs/content/docs/internal/contributing/workflow.mdx) of the docs. Decisions
live in [`.claude/`](.claude/ADR-SYSTEM-GUIDE.md).

## License

MIT
