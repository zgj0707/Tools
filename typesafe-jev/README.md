# TypeSafe Jev plugin

A personal Codex plugin that bundles the `jev_evaluate` MCP tool and the `typesafe-jev` skill for focused, typed judgments.

## Requirements

- Python 3.12 or later
- `uv` available on `PATH`
- A TypeSafe API key available locally as `TYPESAFE_API_KEY`

The MCP server reads `TYPESAFE_API_KEY` from the process environment. On Windows, it also checks the current user's environment registry. Keep the key out of plugin files and Git history.

## Local setup

From this directory, install the locked dependencies with:

```powershell
uv sync --locked
```

The bundled `.mcp.json` starts the server with `uv run --project . --locked python server.py`, using the plugin directory as its working directory. The API key is intentionally not embedded in this configuration.
