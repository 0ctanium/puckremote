# Changesets

All `@puck-remote/*` packages are versioned together (`fixed`), so a theme built with
`@puck-remote/sdk@x.y` always pairs with `@puck-remote/core@x.y`. The theme ↔ host wire contract
is additionally versioned by `sdkMajor` in the artifact manifest.

Add a changeset with `pnpm changeset`, version with `pnpm version-packages`, publish with `pnpm release`.
