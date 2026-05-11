---
title: Create plugins
description: "Build your own LiteAI plugins — manifest schema, tool registration, hooks, and distribution."
---

# Create plugins

Plugins let you extend LiteAI with custom tools, lifecycle hooks, and integrations. This guide covers the plugin API and distribution.

## Plugin structure

```
my-plugin/
├── package.json          # Standard npm package
├── manifest.json         # Plugin manifest
└── src/
    └── index.ts          # Plugin entry point
```

## Manifest schema

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom LiteAI plugin",
  "entry": "./src/index.ts",
  "tools": ["custom_tool"],
  "hooks": ["onSessionStart", "onTurnComplete"],
  "env": {
    "MY_API_KEY": {
      "description": "API key for the external service",
      "required": true
    }
  }
}
```

## Plugin entry point

```typescript
import type { PluginContext } from '@liteai/core'

export default function activate(ctx: PluginContext) {
  // Register a custom tool
  ctx.registerTool({
    name: 'custom_tool',
    description: 'Does something useful',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The input to process' }
      },
      required: ['input']
    },
    execute: async (params) => {
      return { result: `Processed: ${params.input}` }
    }
  })

  // Register lifecycle hooks
  ctx.onSessionStart(async (session) => {
    console.log(`Session started: ${session.id}`)
  })
}
```

## Distribution

### npm

Publish to npm and install via `bun add`:

```bash
bun publish
```

### Local

Drop the plugin directory into `.liteai/plugins/` or reference via `LITEAI_PLUGIN_DIR`.

## What's next?

- [**Plugins reference**](/reference/plugins-reference) — Full API surface
- [**Automate with hooks**](/build/hooks) — Hook system details
