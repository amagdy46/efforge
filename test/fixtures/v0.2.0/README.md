# Projects made by efforge 0.2.0

`d1-effect-sql-auth/` holds the files `efforge add realtime` and `efforge add email` read
from a project the 0.2.0 release generated, unchanged. It is how tests check that `add`
repairs a real 0.2.0 project, without depending on the `v0.2.0` tag (CI checks out
without tags). Produced with:

```sh
git archive v0.2.0 | tar -x -C v020 && (cd v020 && pnpm install)
node v020/src/bin.ts old-db --yes --database=d1 --orm=effect-sql --no-install --no-git
```

The project was generated as `old-db` (its `package.json` says so); the directory here is named after its stack.

The defaults filled in `--auth=better-auth-orgs`. Only these files were kept: the root
`package.json` (`packageManager: pnpm@12.4.2`), `pnpm-workspace.yaml` (no Effect
overrides, `effect` 4.0.5), `efforge.jsonc` with the recorded hashes, the dashboard
(`apps/web/src/routes/app/index.tsx`, which does not render `widgets`), and the files
the two add-ons transform.
