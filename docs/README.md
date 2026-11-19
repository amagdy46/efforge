# efforge docs

Read in this order if you are new. Each line says what the page is for.

1. [Why your app is shaped like this](architecture.md): services, layers, the one file that composes them, and how a request reaches Cloudflare. Start here.
2. [Swap a layer to test](testing.md): test layers, the test rules the project enforces, and how to test a server function.
3. [Add-ons](addons/README.md): one page per add-on, with what it adds, what it edits, its dependencies and its environment variables. Generated from the manifests.
4. [Capability cards](capability-cards.md): the dashboard's cards, and how an add-on contributes one.
5. [Deploy](deploy.md): the first deploy, with wrangler or with Alchemy, and why each step is there.
6. [Keep a project current](upgrading.md): `doctor` and `upgrade`, what efforge will and won't touch, and a 0.2.0 project brought forward.
7. [CLI reference](cli.md): every command and flag, exit codes, CI use and troubleshooting.
8. [`--json`](json.md): the documents every command prints for scripts and coding agents.
9. [Status and limits](limits.md): what efforge does not do yet, and known gaps.
10. [Decisions](decisions/): why efforge is built the way it is, one record per decision.
11. [Brand](brand.md): the mark, the palette and how the brand assets are generated.

Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md). Security reports: [SECURITY.md](../SECURITY.md).
