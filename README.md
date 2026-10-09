# Claudify

A Claude Code plugin that adds a pane with what you usually check by hand while you work:

- **Usage limits**: the session and weekly limits of your Claude plan, with how much is left and when each one resets.
- **Project**: a score for the current repository, plus checks for a connected GitHub repo, graphify and [Ponytail](https://github.com/dietrichgebert/ponytail).
- **Actions**: buttons for the project's `npm run dev` and `npm start` (with their output, and a Stop), and a GitHub button that creates or publishes the repo, or commits and pushes. The commit message is written by Claude, and nothing runs until you confirm it.
- **Skills, MCP servers, connectors and plugins**: every one this session can use, in collapsible lists. Each one lights up while it is in use, and built-in items are grouped in a drawer.

In the desktop app the pane shows a dashboard. In the terminal it shows the same information as text. It refreshes every 10 seconds.

## Install

```bash
claude plugin marketplace add yirasso/claudify
claude plugin install claudify@tomas-plugins
```

Start a new session afterwards. You can enable, disable or remove the plugin from `/plugin`.

## Use

- `/claudify` opens the pane, or closes it when it is already open.
- In the desktop app, the **Show / Hide Claude panel** button above the prompt shows and hides it.
- In a terminal at least 144 columns wide, the pane opens by itself.

## Develop

```bash
git clone https://github.com/yirasso/claudify.git
cd claudify
claude plugin validate .
claude plugin test .
```

| Path | What it is |
| --- | --- |
| `hooks/register.tsx` | The plugin: hooks, state and the pane |
| `hooks/cards.ts` | The desktop dashboard (one SVG) |
| `types/index.d.ts` | The plugin's state contract |
| `tests/` | Tests for the pane, checks, connectors, scripts and GitHub flow |

To load your working copy in a session, run `claude --plugin-dir <path to the clone>`. If you installed it through the marketplace, run `claude plugin update claudify@tomas-plugins` after making changes.
