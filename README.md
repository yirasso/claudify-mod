# Claudify

A Claude Code plugin that adds a band above the prompt with the project's actions:

- **Start / Stop Project**: runs what the project runs and shows its output: a `package.json` script (`dev`, `start`, `serve` or `preview`, with the lockfile's package manager), `npx expo start`, `cargo run`, `go run .`, a Python entry point (`manage.py runserver`, `main.py`, `app.py`; through `uv run` with a `uv.lock`) or a Godot project. While it runs, **↗ Open** opens its address; if it stops because its port is taken, **✕ Free port N and start** ends what holds the port and starts again; if it fails otherwise, **✦ Send error to Claude** sends the command and its last output to Claude to fix.
- **⬇ Install deps**: shown while `package.json` or the lockfile is newer than the last install (or `uv.lock` than `.venv`). Runs the package manager's install, or `uv sync`.
- **↓ Pull (N)**: shown while GitHub has commits the branch does not (checked every 5 minutes). Brings them in even with local changes or commits (`git pull --rebase --autostash`); if it stops on conflicts, **✦ Resolve conflicts with Claude** hands them over.
- **⚒ Build**: for a project with a `build` script (or Cargo), runs it and shows the result; if it fails, **✦ Send error to Claude**.
- **Save Changes (N)**: shown only while there is something to send to GitHub, with the number of files; it stands out past 15 files or two hours after the last commit. Afterwards **↶ Undo** reverts that commit for 10 seconds. Before it commits, it warns about files or lines that look secret (`.env`, keys, tokens) and can leave them out. Creates or publishes the GitHub repo, or commits and pushes. The commit message is written by Claude Haiku, and nothing runs until you confirm it.
- **Setup Project**: shown only while something is missing. In code: turns [Ponytail](https://github.com/dietrichgebert/ponytail) on for the project, builds the graphify graph (adding `graphify-out/` to `.gitignore`) and starts the GitHub flow. Claude Sonnet only writes the first commit message and reads the docs for the graph.
- **The graph follows the work by itself**: after each turn in which Claude changed code, `graphify update` puts it in (no model); graphify's git hook (installed for you) rebuilds the code after each commit, and the docs a commit changed then go to Claude Sonnet with no button. **Update Graph** stays for whatever is left out of date (a yellow graphify dot).
- **Types**: after each turn in which Claude changed code, the project's typecheck runs (`tsc --noEmit` with a local TypeScript, or `cargo check`); a red **● Types** shows the first errors and **✦ Send type errors to Claude**.
- On the right, the branch (**⎇ name**) when it is not `main`, then **GitHub · graphify · Ponytail**: a green dot (●) when each is on (an `origin` remote on GitHub, a non-empty graphify graph, the Ponytail plugin enabled), a dim hollow one (○) when not, a yellow one when the graph is out of date. Then the **5h** and **Week** limit bars (from 70%, with the time until they reset) and how much of the week this session used, then **📁** (the project folder), **</>** (VS Code, when installed) and **🔔/🔕** (a short chime when a turn that took over a minute ends).

The pane with the session's skills, MCP servers, connectors and plugins lives in its own plugin, `setup-info`.

If something the band needs is missing (git, the GitHub CLI or its login, graphify), a line under it says what and how to fix it.

To turn Claudify off in a project, type `/claudify off`; `/claudify` brings it back.

## Install

```bash
claude plugin marketplace add yirasso/claudify
claude plugin install claudify@tomas-plugins
```

Start a new session afterwards. You can enable, disable or remove the plugin from `/plugin`.

## Develop

```bash
git clone https://github.com/yirasso/claudify.git
cd claudify
claude plugin validate .
claude plugin test .
```

| Path | What it is |
| --- | --- |
| `hooks/register.tsx` | The plugin: hooks, state and the band |
| `types/index.d.ts` | The plugin's state contract |
| `scripts/graph_docs.py` | Merges the docs Claude read into the graphify graph, with no model |
| `tests/` | Tests for the actions, checks, start commands, scripts and GitHub flow |

To load your working copy in a session, run `claude --plugin-dir <path to the clone>`. If you installed it through the marketplace, run `claude plugin update claudify@tomas-plugins` after making changes.
