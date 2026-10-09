# Claudify plugin

A Claude Code plugin (a "mod": function hooks, no MCP server) with one part: the **band above the prompt** with the action buttons on the left (Start/Stop Project; Install deps only while the manifest or lockfile is newer than the last install; Build for a project with a build; Pull only while GitHub is ahead; Save Changes only while something waits to go to GitHub; Setup Project only while GitHub, graphify or Ponytail is off; Update Graph only while commits newer than the graph wait to go into it, with a yellow graphify dot) and, aligned right, the branch when it is not main, a dot for each check (green ● on, dim ○ off) and a Types dot (the typecheck after each turn) the 5-hour and weekly limit bars (from 70% with the time until they reset) and how much of the week this session used, and three icon buttons: 📁 the folder, </> VS Code (when `code` is installed) and 🔔/🔕 the long-turn sound, and the script output (with Open for its address, Free port when its port was taken, and Send error to Claude when it failed) and the GitHub confirm flow under them.

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
  - `claude plugin test .` (42 tests, 9 files)
  - the typecheck: `npx -y -p typescript tsc -p tsconfig.json` (TypeScript is not installed in the repo, so plain `npx tsc` fails), against the API types in `.claude-plugin/types/`. That folder is generated and git-ignored; the plugin-authoring skill regenerates it.
- **For the API, load the `plugin-authoring` skill** before touching the hooks: it has the full contract.

## Layout

- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx`: every hook.
  - **Events handled:** `session.start`, `turn.complete`, `ui.render` (`AbovePrompt`), `session.measure` (the limit bars), `session.end`, `command.run` (`/claudify off`, `/claudify`).
  - **What it renders:** `AbovePrompt` (the band: `actionBar`).
  - **Its functions:** `readProject` (every 10 s, via `$.clock.every`), `installCommand` (npm/pnpm/yarn/bun install or `uv sync`, by comparing mtimes with the last install's record), `startCommand` (what Start Project runs: a package.json script, Expo, Cargo, Go, Python, Godot), `runScript`/`stopScript`/`killTree`/`freePortAndStart`/`openUrl`/`sendError` (submits the failed command, code and last 40 lines as a prompt), `fetchRemote` (every 5 min)/`pullChanges`, `followTurn` (after a main-thread turn that changed code: the code graph, no model), `followCommits` (a new HEAD: graphify's own post-commit hook, installed by `installGraphHook`, rebuilds the code; the band waits for graph.json to be newer than the commit, then sends that commit's docs to Sonnet with no button), `refreshCodeGraph` (after a push or a pull: the code graph with no model, docs left in `graphify-out/.claudify_docs_since`), `prepareGithub`/`runGithub` (the commit message comes from `$.model.complete` with Haiku 5.5 at medium effort, Sonnet 5.5 when Setup Project calls it, and nothing runs before the user confirms), `setupProject`/`enablePonytail`/`updateGraph`/`addDocs`, `actionBar`.
  - **Setup Project and Update Graph run in code; a model only where code can't:** Ponytail goes on in the project's `.claude/settings.json`, `graphify-out/` into `.gitignore`, `graphify update .` builds the code graph with no model. Only docs (`.md`, `.mdx`, `.txt`, `.rst`) changed since the graph go to Sonnet 5.5 (medium effort) through `$.model.complete` (`addDocs`): their text in batches, with the graphify skill's own extraction spec (`~/.claude/skills/graphify/references/extraction-spec.md`). `scripts/graph_docs.py`, run with graphify's Python, merges the chunks into the graph in code (cache, merge, cluster, community names kept from the old graph, report, html).
- `types/index.d.ts`: the state contract (`PluginState`). The atoms are `project` (with `pending`: something to send to GitHub), `runs`, `github`, `limits`, `graphJob` (the graph update's line) and `weekStart` (the weekly reading the session started from: «Session +N%» is the week minus it; a weekly reset or `/clear` starts it over).
- `scripts/open_folder.ps1`: opens the project folder in Explorer, in front.
- `scripts/graph_docs.py`: merges Sonnet's doc chunks into the graph, run with graphify's Python.
- `tests/`: `actions`, `checks`, `extras`, `github`, `pull`, `safety`, `scripts`, `start`, `types`.

## Behaviour

- **Save Changes** shows the files waiting and turns primary with more than 15 or two hours after the last commit; after it, **↶ Undo** (10 s) reverts the commit and pushes the revert.
- **A turn over a minute** ends with the done sound (`sounds/done.wav`, a chime generated for the band; PowerShell's SoundPlayer on Windows, `$.audio.play` elsewhere), unless the bell is off (`notify` atom, kept in `$.store`).
- **The typecheck** (`checkTypes`) runs after each main-thread turn that changed code: the project's own `typecheck`/`type-check`/`check-types` script first; else `npx --no-install tsc --noEmit` on the tsconfig, or on each tsconfig a references-only root lists (electron-vite's root has `"files": []` and checks nothing); no download, so without a local TypeScript there is no dot; `cargo check` for Cargo. A red dot shows the first errors and `✦ Send N type errors to Claude`.
- **`/claudify off`** hides the band and stops the automatic work in that project; kept in `$.store` as `off:<folder>`; `/claudify` (no argument) turns it on. There is no `/claudify on`.
- **Save Changes checks for secrets** (`findSecrets`): secret-looking files (`.env*` but not `.env.example`, keys, credentials) and diff lines adding tokens (`sk-…`, `ghp_…`, `AKIA…`, private keys). It names the files, never the secret; **Leave them out (.gitignore)** ignores and unstages them, or **Commit & push anyway**.
- **Pull** runs `git pull --rebase --autostash` (local changes and commits come back on top); if it stops on conflicts, **✦ Resolve conflicts with Claude** sends the files. A push GitHub refuses (newer commits) fetches so ↓ Pull shows.
- **⚒ Build** runs the `build` script (or `cargo build --release`) as a run like Start Project's, with Send error when it fails.
- **A health line** (`checkHealth`, once per load) says what the band needs and is missing: git, `gh` or its login, graphify.
- **Commits and the band are always in English.**
- **Finished work folds back after 2 s** (`collapseSoon`): the GitHub flow's lines, a graph failure, and runs that ended. A failed run with a button (Send error, Free port) stays.

## Rules learned the hard way

**Validator and API**
- **The plugin name** can't start with `claude-`.
- **Atom refs** need literal plugin and key strings.
- **`$`** may only be passed to top-level functions declared in the same file: never to an imported one. That is why everything is in one `register.tsx`; splitting it by area was tried (0.7.4) and the engine refused to load it.
- **`$.ui.resolve(e)`** gives the elements per surface: Box/Text/Button everywhere, Svg on desktop only.
- **The graphify check** uses `$.session.cwd()` plus `graphify-out/graph.json`. `fs.list('.')` failed.
- **A plugin can't spawn an Agent under auto mode**: the classifier refuses it ("the request that produced this action did not ask for one"). Call the model with `$.model.complete` instead.
- **`$.state` outlives `/reload-plugins`**: a line left from a failed run stays; `session.start` clears `graphJob`.
- **Windows opened from the engine stay behind Claude** (the foreground lock): every way of opening Explorer worked, but the windows piled up out of sight. `scripts/open_folder.ps1` reuses the folder's window or opens one, then lifts it with SetWindowPos (topmost, then not) and gives it the focus through AttachThreadInput; the Alt-key trick alone did not work.
- **`$.fs.write`/`read` with a relative path** resolve against the process, not the session folder: build paths from `$.session.cwd()`.
- **`graphify update .`** (code only) re-reads `README.md` as code and drops its semantic nodes; the next docs pass brings them back.
- **`graphify hook install`** adds post-commit/post-checkout hooks (code only, background rebuild) and a merge driver line in `.gitattributes`; `keepGraphAttributesLocal` moves that line to `.git/info/attributes`.
- **Freeing a port** on Windows: `netstat -ano` (not `-p tcp`, which hides the IPv6 rows Node listens on).
- **Stopping a script** on Windows: `taskkill /T /F` exits with code 1. Show «stopped», not a failure.
- **TS literal widening** in `update(...)`: type the records (`ScriptRun`, `GithubFlow`).

**Test kit**
- `on(...)` answers return `{ value: ... }`.
- `process.run` gets `{ argv, init: { stdin } }`.
- Register every `on()` before the first `$` call.
- A second `ui.mount` needs another `requestId`.
- `$.clock` exists at runtime, but the kit's types leave it out.
- A `model.complete` answer is `{ value: ... }`; `fs.read`/`fs.write` hooks get absolute paths with backslashes.

**Design (Tomás's feedback)**
- No glass icons and no fancy decoration: he called a first card UI «bugado e feio».
- He dropped the SVG dashboard (usage rings, project score, tiles) on 2026-10-09: the actions are real buttons. Use real `Button`s, not drawings with labels laid over them.

## Open

- Not confirmed in Claude Desktop: how the band's buttons look in Claude Desktop.
- In Claude Desktop the band is missing in a new session and after `/clear` until the first message is sent; a redraw on `session.end` (`reason: 'clear'`) did not help (0.5.5, reverted in 0.5.6). Most likely the app starts the session's process only with the first message, so no mod can draw before it.
