# efforge

`npm create efforge` scaffolds a full-stack TypeScript app on an opinionated Effect stack, where every part can be swapped out.

> **Status: spike.** It runs the interactive flow and writes an `efforge.json` manifest. It does not generate an app yet.

## Try it

```sh
pnpm install
node src/main.ts                       # interactive
node src/main.ts demo -y --database=d1 --infra=alchemy --extras=workflows,realtime
node src/main.ts --help
```

Requires Node 23.6 or newer, which runs TypeScript directly.

## Slots

| Slot | Options | Default |
|---|---|---|
| runtime | `cloudflare`, `node` | cloudflare |
| database | `postgres` (any URL), `neon`, `supabase`, `d1`, `sqlite`, `none` | postgres |
| auth | `better-auth-orgs`, `better-auth`, `none` | better-auth-orgs |
| infra | `none`, `alchemy` | none |
| ai | `none`, `effect-ai-byok` | none |
| extras | `workflows`, `realtime`, `browser`, `storage`, `email` | — |

Options are filtered by your earlier choices. For example, D1 and Workflows require the Cloudflare runtime.

## Planned

- Real templates and add-ons. Each add-on is data: files, dependencies, env vars and infra edits.
- `efforge add <addon>` for existing projects.
- Publish to npm.

Built with [Effect](https://effect.website) (`effect/cli`) and [@clack/prompts](https://github.com/bombshell-dev/clack).
