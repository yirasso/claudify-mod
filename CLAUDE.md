# Claudify plugin

A Claude Code plugin (a "mod": function hooks, no MCP server) with one part: the **band above the prompt** with three action buttons (Start/Stop Project, Save Changes, Setup Project) and a dot for each check (GitHub, graphify, Ponytail: green ● on, dim ○ off), and the script output and the GitHub confirm flow under them.

The pane with the session's skills, MCP servers, connectors and plugins moved on 2026-10-09 to its own plugin, `setup-info`, in `C:\Dev\Claude Setup Info`.

The owner is Tomás. He talks in European Portuguese (never Brazilian); the plugin's UI and code are in English. Repo: https://github.com/yirasso/claudify (branch `main`).

## Install and reload

- **Installed for Tomás from GitHub** as `claudify@tomas-plugins`: the marketplace `tomas-plugins` is `yirasso/claudify` (`.claude-plugin/marketplace.json`, with the plugin at `source: "./"`). Claude Code runs a copy in `~/.claude/plugins/cache/tomas-plugins/claudify/<version>/`, not this folder.
  - **To ship a change:** bump `version` in `.claude-plugin/plugin.json`, commit, push to `main`, then `claude plugin update claudify@tomas-plugins` and `/reload-plugins`.
  - **To try edits before pushing:** `claude --plugin-dir C:\Dev\Claudify`.
- **The `claude` CLI is not on PATH.** The binary is `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe` (it was `2.1.293\83cb0bd7fed4` on 9 Oct 2026).
- **Every change ships.** After each change (the three checks below passing): bump `version`, commit, push to `main`, `claude plugin update claudify@tomas-plugins` and `/reload-plugins`, so Tomás sees it in Claude straight away. No separate HTML mock-up: the UI is designed directly in `hooks/register.tsx`.
- **Before finishing a change**, all three must pass:
  - `claude plugin validate .`
  - `claude plugin test .` (9 tests, 4 files)
  - the typecheck: `npx -y -p typescript tsc -p tsconfig.json` (TypeScript is not installed in the repo, so plain `npx tsc` fails), against the API types in `.claude-plugin/types/`. That folder is generated and git-ignored; the plugin-authoring skill regenerates it.
- **For the API, load the `plugin-authoring` skill** before touching the hooks: it has the full contract.

## Layout

- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx`: every hook.
  - **Events handled:** `session.start`, `turn.complete`, `ui.render` (`AbovePrompt`), `session.end`.
  - **What it renders:** `AbovePrompt` (the band: `actionBar`).
  - **Its functions:** `readProject` (every 10 s, via `$.clock.every`), `runScript`/`stopScript`/`killTree`, `prepareGithub`/`runGithub` (the commit message comes from `$.model.complete` with Sonnet 5.5 at medium effort, and nothing runs before the user confirms), `actionBar`.
- `types/index.d.ts`: the state contract (`PluginState`). The atoms are `project`, `runs` and `github`.
- `tests/`: `actions`, `checks`, `github`, `scripts`.

## Rules learned the hard way

**Validator and API**
- **The plugin name** can't start with `claude-`.
- **Atom refs** need literal plugin and key strings.
- **`$`** may only be passed to top-level functions.
- **`$.ui.resolve(e)`** gives the elements per surface: Box/Text/Button everywhere, Svg on desktop only.
- **The graphify check** uses `$.session.cwd()` plus `graphify-out/graph.json`. `fs.list('.')` failed.
- **Stopping a script** on Windows: `taskkill /T /F` exits with code 1. Show «stopped», not a failure.
- **TS literal widening** in `update(...)`: type the records (`ScriptRun`, `GithubFlow`).

**Test kit**
- `on(...)` answers return `{ value: ... }`.
- `process.run` gets `{ argv, init: { stdin } }`.
- Register every `on()` before the first `$` call.
- A second `ui.mount` needs another `requestId`.
- `$.clock` exists at runtime, but the kit's types leave it out.

**Design (Tomás's feedback)**
- No glass icons and no fancy decoration: he called a first card UI «bugado e feio».
- He dropped the SVG dashboard (usage rings, project score, tiles) on 2026-10-09: the actions are real buttons. Use real `Button`s, not drawings with labels laid over them.

## Open

- Not confirmed in Claude Desktop: how the band's buttons look in Claude Desktop.
