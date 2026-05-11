---
title: Debug configuration
description: "Debug configuration resolution, environment variable precedence, and telemetry enablement."
---

# Debug configuration

## Check active configuration

View the resolved configuration for a project:

```bash
curl http://localhost:3000/config
```

This shows the merged result of global + project + environment settings.

## Resolution order

Configuration is merged in this order (later overrides earlier):

1. `~/.liteai/settings.json` (global)
2. `.liteai/settings.json` (project)
3. `LITEAI_*` environment variables
4. CLI flags (`--model`, `--provider`)

## Common issues

### Settings not taking effect

- Check the file path — is `.liteai/settings.json` at the project root?
- Verify JSON syntax — LiteAI supports comments but not trailing commas
- Check environment variable precedence — env vars override file settings

### Project config disabled

If `LITEAI_DISABLE_PROJECT_CONFIG=true` is set, project-level settings are ignored entirely.

### Custom config path

Override the settings file location:

```bash
export LITEAI_CONFIG=/path/to/custom/settings.json
export LITEAI_CONFIG_DIR=/path/to/custom/.liteai/
```

## What's next?

- [**Settings reference**](/configuration/settings) — Full schema
- [**Environment variables**](/reference/environment-variables) — Complete reference
