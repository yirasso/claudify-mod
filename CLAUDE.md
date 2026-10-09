# Claudify plugin

A Claude Code plugin (a "mod": function hooks, no MCP server) that shows a pane with:

- the Claude plan's usage limits;
- the project's score and checks (GitHub repo, graphify, Ponytail);
- npm dev/start buttons and a GitHub button;
- collapsible lists of the session's skills, MCP servers, connectors and plugins, each lit up while in use.

The owner is Tomás. He talks in European Portuguese (never Brazilian); the plugin's UI and code are in English. Repo: https://github.com/yirasso/claudify (branch `main`).

## Install and reload

- **Installed for Tomás from GitHub** as `claudify@tomas-plugins`: the marketplace `tomas-plugins` is `yirasso/claudify` (`.claude-plugin/marketplace.json`, with the plugin at `source: "./"`). Claude Code runs a copy in `~/.claude/plugins/cache/tomas-plugins/claudify/<version>/`, not this folder.
  - **To ship a change:** bump `version` in `.claude-plugin/plugin.json`, commit, push to `main`, then `claude plugin update claudify@tomas-plugins` and `/reload-plugins`.
  - **To try edits before pushing:** `claude --plugin-dir C:\Dev\Claudify`.
- **The `claude` CLI is not on PATH.** The binary is `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe` (it was `2.1.293\83cb0bd7fed4` on 9 Oct 2026).
- **Every change ships.** After each change (the three checks below passing): bump `version`, commit, push to `main`, `claude plugin update claudify@tomas-plugins` and `/reload-plugins`, so Tomás sees it in Claude straight away. No separate HTML mock-up: the UI is designed directly in `hooks/cards.ts` and `hooks/register.tsx`.
- **Before finishing a change**, all three must pass:
  - `claude plugin validate .`
  - `claude plugin test .` (17 tests, 6 files)
  - the typecheck: `npx -y -p typescript tsc -p tsconfig.json` (TypeScript is not installed in the repo, so plain `npx tsc` fails), against the API types in `.claude-plugin/types/`. That folder is generated and git-ignored; the plugin-authoring skill regenerates it.
- **For the API, load the `plugin-authoring` skill** before touching the hooks: it has the full contract.

## Layout

- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx`: every hook.
  - **Events handled:** `session.start`, `command.run` (`/claudify`, which toggles the pane), `session.measure`, `skill.prompt`, `tool.call`, `turn.complete`, `ui.render`, `ui.close`, `session.end`.
  - **What it renders:** `Pane` (the board) and `AbovePrompt` (the «Show/Hide Claude panel» band button, desktop).
  - **Its functions:** `refresh` (every 10 s, via `$.clock.every`), `readProject`, `runScript`/`stopScript`/`killTree`, `prepareGithub`/`runGithub` (the commit message comes from `$.model.complete` with Sonnet 5.5 at medium effort, and nothing runs before the user confirms), `openPane` and `guessConnector` (claude.ai connectors arrive as UUIDs, so their names are guessed).
- `hooks/cards.ts`: `dashboard(d)` returns one 480-wide SVG (usage rings, project hero, repository and context tiles). The actions are not in it: `actionButtons` in `register.tsx` draws four real `Button`s (▶ Start/■ Stop Project, ↑ Save Changes, ⚙ Setup Project, ⇊ Compact) in the pane and in the band above the prompt.
  - The style is copied from Tomás's reference: https://dribbble.com/shots/26970884-Investment-Dashboard-Widget (light cards, rounded bars, a score arc).
  - It shows on desktop only, as `<Svg>`. The terminal gets a text version.
- `types/index.d.ts`: the state contract (`PluginState`). The atoms are `limits`, `skills`, `servers`, `busy`, `used`, `tick`, `project`, `runs`, `open`, `github`, `context` and `paneOpen`.
- `tests/`: `actions`, `board`, `checks`, `connectors`, `github`, `scripts`.

## Rules learned the hard way

**Validator and API**
- **The plugin name** can't start with `claude-`.
- **Atom refs** need literal plugin and key strings.
- **`$`** may only be passed to top-level functions.
- **`$.ui.resolve(e)`** gives the elements per surface: Box/Text/Button everywhere, Svg on desktop only.
- **Opening the pane:** a pane opened without being asked seats only from 144 terminal columns. One opened on request (the command or the band button) always seats.
- **Removed items:** show only what the session lists right now (`$.tool.list()`, `$.session.usage`). Otherwise removed skills and connectors stay in the pane.
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
- Follow the Dribbble reference closely, and preview the SVG in a browser before shipping it.

## Open

- Not confirmed in Claude Desktop: whether the band button renders, and how the dashboard looks with live data.
