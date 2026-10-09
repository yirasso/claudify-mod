# Claudify

A Claude Code plugin that adds a band above the prompt with the project's actions:

- **Start / Stop Project**: runs what the project runs and shows its output: a `package.json` script (`dev`, `start`, `serve` or `preview`, with the lockfile's package manager), `npx expo start`, `cargo run`, `go run .`, a Python entry point (`manage.py runserver`, `main.py`, `app.py`; through `uv run` with a `uv.lock`) or a Godot project. While it runs, **↗ Open** opens its address; if it stops because its port is taken, **✕ Free port N and start** ends what holds the port and starts again.
- **↓ Pull (N)**: shown while GitHub has commits the branch does not (checked every 5 minutes). Fast-forwards the branch.
- **Save Changes**: shown only while there is something to send to GitHub. Creates or publishes the GitHub repo, or commits and pushes. The commit message is written by Claude Haiku, and nothing runs until you confirm it.
- **Setup Project**: shown only while something is missing. In code: turns [Ponytail](https://github.com/dietrichgebert/ponytail) on for the project, builds the graphify graph (adding `graphify-out/` to `.gitignore`) and starts the GitHub flow. Claude Sonnet only writes the first commit message and reads the docs for the graph.
- **Update Graph**: shown while the graph is out of date (a yellow graphify dot). `graphify update` reads the code with no model; only docs changed since go to Claude Sonnet. After a push or a pull the code part updates by itself, and changed docs wait for this button.
- On the right, **GitHub · graphify · Ponytail**: a green dot (●) when each is on (an `origin` remote on GitHub, a non-empty graphify graph, the Ponytail plugin enabled), a dim hollow one (○) when not, a yellow one when the graph is out of date. Then the **5h** and **Week** limit bars and how much of the week this session used.

The pane with the session's skills, MCP servers, connectors and plugins lives in its own plugin, `setup-info`.

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
