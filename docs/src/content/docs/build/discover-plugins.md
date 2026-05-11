---
title: Discover and install plugins
description: "Find and install prebuilt plugins to extend LiteAI with new tools and capabilities."
---

# Discover and install plugins

Plugins are runtime-loaded extensions that add new tools, hooks, and capabilities to LiteAI.

## Installing plugins

### From npm

```bash
cd your-project
bun add @liteai/plugin-example
```

Then reference in `settings.json`:

```json
{
  "plugins": ["@liteai/plugin-example"]
}
```

### From a local directory

```json
{
  "plugins": ["./plugins/my-plugin"]
}
```

Or use the environment variable:

```bash
export LITEAI_PLUGIN_DIR=./plugins/my-plugin,./plugins/another-plugin
```

### From `.liteai/plugins/`

Drop plugin folders directly into `.liteai/plugins/` for auto-discovery.

## Plugin manifest

Each plugin must include a manifest:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Adds custom tools for database management",
  "tools": ["db_query", "db_migrate"],
  "hooks": ["onSessionStart"]
}
```

## Environment variables

Plugins can declare required environment variables:

```json
{
  "env": {
    "DATABASE_URL": {
      "description": "PostgreSQL connection string",
      "required": true
    }
  }
}
```

## What's next?

- [**Create plugins**](/build/create-plugins) — Build your own plugins
- [**Plugins reference**](/reference/plugins-reference) — Full API reference
