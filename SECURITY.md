# Security

## Report a vulnerability

Report it privately through GitHub: open the repo's **Security** tab and choose **Report a vulnerability**, or go to <https://github.com/amagdy46/efforge/security/advisories/new>. Do not open a public issue.

Include the efforge version, the command you ran (or the stack from `efforge.jsonc`), and how to reproduce the problem.

## In scope

- The CLI: `create-efforge` on npm (`npm create efforge`, `efforge add`, `efforge list`).
- The code it generates: anything under `templates/` as it lands in a new project, such as the auth guards, signed storage URLs, the browser container's URL policy and the AI key storage.

## Out of scope

- Vulnerabilities in dependencies (Effect, TanStack Start, Better Auth, Drizzle, wrangler, Alchemy and others). Report those upstream. If efforge pins a version with a known vulnerability, that is in scope.
- Code you changed after generating the project.
- Cloudflare's platform itself.

Only the latest release gets fixes.
