## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one. -->

## How you checked it

- [ ] `pnpm typecheck && pnpm lint && pnpm format --check && pnpm test && pnpm build`
- [ ] If it changes templates or the CLI: the stacks it touches, generated and gated (`pnpm test:e2e -t "^stacks build > <case>$"`; check the summary says a test passed)
- [ ] If it changes a dependency or the build: `pnpm smoke:pack`
- [ ] If it changes an `addon.json`: `pnpm docs:addons`
- [ ] A line under `Unreleased` in `CHANGELOG.md`, if users will notice

<!-- Paste the commands you ran and what they printed, or say which you skipped and why. -->

A design decision goes in `docs/decisions/`. See [CONTRIBUTING.md](../CONTRIBUTING.md).
