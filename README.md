# Claudify

A Claude Code plugin that adds a band above the prompt with the project's actions:

- **Start / Stop Project**: runs the project's `npm run dev` (or `start`) and shows its output.
- **Save Changes**: creates or publishes the GitHub repo, or commits and pushes. The commit message is written by Claude, and nothing runs until you confirm it.
- **Setup Project**: asks Claude to build the graphify graph and install [Ponytail](https://github.com/dietrichgebert/ponytail) when they are missing.
- **Compact**: compacts the conversation, like `/compact`.

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
| `tests/` | Tests for the actions, checks, scripts and GitHub flow |

To load your working copy in a session, run `claude --plugin-dir <path to the clone>`. If you installed it through the marketplace, run `claude plugin update claudify@tomas-plugins` after making changes.
