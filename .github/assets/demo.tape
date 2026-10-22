# Records .github/assets/demo.gif: `vhs .github/assets/demo.tape` from the repo root.
# Needs vhs and ttyd (e.g. `mise exec aqua:charmbracelet/vhs aqua:tsl0922/ttyd -- vhs ...`)
# and pnpm with a warm store, so the install takes a couple of seconds.
# EFFORGE_BIN (optional) points npm/npx at a local build: `EFFORGE_BIN=$PWD/dist/bin.js vhs ...`.

Output .github/assets/demo.gif

Require pnpm

Set Shell "bash"
Set FontSize 16
Set Width 1100
Set Height 860
Set Padding 20
Set Margin 0
Set WindowBar Colorful
Set BorderRadius 8
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 24
Set WaitTimeout 90s

Hide
Type `export PS1='\[\e[2m\]$\[\e[0m\] '; cd "$(mktemp -d)"`
Enter
Type `if [ -n "$EFFORGE_BIN" ]; then npm() { [ "$1" = create ] && { shift 2; node "$EFFORGE_BIN" "$@"; return; }; command npm "$@"; }; npx() { [ "$1" = create-efforge ] && { shift; node "$EFFORGE_BIN" "$@"; return; }; command npx "$@"; }; fi; clear`
Enter
Show

Type "npm create efforge my-app"
Sleep 400ms
Enter

# Database: Cloudflare D1
Wait+Screen /Database/
Sleep 900ms
Down
Sleep 500ms
Enter
# ORM: Effect SQL
Wait+Screen /ORM/
Sleep 700ms
Down
Sleep 500ms
Enter
# Auth: Better Auth + organizations (default)
Wait+Screen /Auth/
Sleep 900ms
Enter
# Infrastructure: none
Wait+Screen /Infrastructure/
Sleep 600ms
Enter
# AI: none
Wait+Screen /AI/
Sleep 600ms
Enter
# Extras: Storage
Wait+Screen /Extras/
Sleep 600ms
Down 3
Sleep 300ms
Space
Sleep 600ms
Enter
# vhs only matches the first screenful, so the rest is timed
Sleep 2500ms
Enter
Sleep 9s

Type "cd my-app && npx create-efforge add email"
Sleep 400ms
Enter
Sleep 9s
