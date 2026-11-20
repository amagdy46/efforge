# Records .github/assets/demo.gif: `pnpm readme:demo` (vhs .github/assets/demo.tape) from the repo root.
# Needs vhs and ttyd (e.g. `mise exec aqua:charmbracelet/vhs aqua:tsl0922/ttyd -- vhs ...`)
# and pnpm with a warm store, so the install takes a couple of seconds.
# EFFORGE_BIN (optional) points npm/npx at a local build: `pnpm build && EFFORGE_BIN=$PWD/dist/bin.js vhs ...`.
# The colours are docs/brand.md's: Iron background, Paper text, Blued steel and Temper purple on
# Iron, Straw, Assay red for errors only. No orange.

Output .github/assets/demo.gif

Require pnpm

Set Shell "bash"
Set FontSize 18
Set Width 960
Set Height 760
Set Padding 24
Set Margin 0
Set WindowBar Colorful
Set BorderRadius 8
Set Theme { "name": "efforge", "background": "#1C1D20", "foreground": "#F6F5F1", "cursor": "#7DA2E3", "selection": "#2F5AA8", "black": "#1C1D20", "brightBlack": "#8A8F98", "red": "#E8786E", "brightRed": "#E8786E", "green": "#8CC4A8", "brightGreen": "#8CC4A8", "yellow": "#E2C275", "brightYellow": "#E2C275", "blue": "#7DA2E3", "brightBlue": "#7DA2E3", "magenta": "#AD8FDB", "brightMagenta": "#AD8FDB", "cyan": "#9CC3E8", "brightCyan": "#9CC3E8", "white": "#C9CDD2", "brightWhite": "#F6F5F1" }
Set TypingSpeed 40ms
Set Framerate 15
Set WaitTimeout 90s

Hide
Type `export PS1='\[\e[2m\]$\[\e[0m\] ' GIT_PAGER=cat GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.mnemonicPrefix GIT_CONFIG_VALUE_0=false; cd "$(mktemp -d)"`
Enter
Type `if [ -n "$EFFORGE_BIN" ]; then npm() { [ "$1" = create ] && { shift 2; node "$EFFORGE_BIN" "$@"; return; }; command npm "$@"; }; npx() { [ "$1" = -y ] && [ "$2" = create-efforge ] && { shift 2; node "$EFFORGE_BIN" "$@"; return; }; command npx "$@"; }; fi; clear`
Enter
Show

Type "npm create efforge my-app"
Sleep 300ms
Enter

# Preset: ai (D1, Effect SQL, Better Auth, AI with your own key, realtime)
Wait+Screen /preset/
Sleep 1500ms
Down
Sleep 1200ms
Enter
# The stack, then "Create it in ./my-app?": Yes
Wait+Screen /Create it/
Sleep 2500ms
Enter
# the prompt is back: create is done
Wait+Line /^\$ *$/
Sleep 3s

# a clean screen for the second command
Hide
Type "clear"
Enter
Show
Type "cd my-app && npx -y create-efforge add email"
Sleep 300ms
Enter
Wait+Line /^\$ *$/
Sleep 3500ms

# the one file that composes the app gained one layer
Hide
Type "clear"
Enter
Show
Type "git diff apps/web/src/server/layers.ts"
Sleep 300ms
Enter
Sleep 5s
