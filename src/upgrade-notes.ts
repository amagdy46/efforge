// What efforge's newer version of a generated file is for, in one clause, so a project owner who
// edited the file can decide whether to take the change. Keep it to changes since the last
// release; CHANGELOG.md has the rest. First match wins.

const notes: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^apps\/web\/src\/routes\/app\/index\.tsx$/,
    "the dashboard shows one card per capability, a working demo beside the Effect code behind it",
  ],
  [
    /^apps\/web\/src\/routes\/index\.tsx$/,
    "the landing page names the project and shows its stack, read from efforge.jsonc",
  ],
  [
    /^apps\/web\/(regions\.ts|src\/regions\.d\.ts|src\/capabilities\/|src\/components\/(capability-card|code-block|layer-graph|demo)\.tsx|src\/lib\/(highlight|layer-graph|use-server-call)\.ts)/,
    "capability cards: the dashboard shows each capability and the marked region of its code",
  ],
  [
    /^apps\/web\/src\/(server\/(outcome|settings)\.ts|lib\/failure\.ts|components\/error-page\.tsx)$/,
    'a missing setting shows as a page that names it, and as "not configured" on a card, instead of a 500',
  ],
  [
    /^apps\/web\/src\/server\/auth(-url|-live)?\.ts$/,
    "Better Auth's base URL comes from BETTER_AUTH_URL, or the request in development, and its setup settles in the request that starts it",
  ],
  [
    /^apps\/web\/src\/server\/(greeting|notes|account|realtime-demo|stack|manifest)\.ts$/,
    "server functions return an Outcome, so the dashboard can say what is missing instead of failing",
  ],
  [
    /^packages\/[^/]+\/(src|test)\//,
    "each capability's service and a test that swaps in a test layer and checks a tagged error",
  ],
  [
    /^apps\/web\/src\/server\/layers\.ts$/,
    "AppLayer sits in a `// #region card` block, which the dashboard's runtime card shows",
  ],
  [
    /^AGENTS\.md$/,
    "AGENTS.md describes capability cards, tests with test layers and the add command",
  ],
  [/^README\.md$/, "the README's commands and the made-with-efforge badge"],
  [
    /^apps\/web\/src\/(routes\/(__root|app)\.tsx|router\.tsx|start\.ts|components\/app-shell\.tsx)$/,
    "the app shell and the error pages",
  ],
]

/** What efforge's change to `path` is for, or undefined when it has no note. */
export const upgradeNote = (path: string): string | undefined =>
  notes.find(([re]) => re.test(path))?.[1]
