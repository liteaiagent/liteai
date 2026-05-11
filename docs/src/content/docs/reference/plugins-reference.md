---
title: Plugins reference
description: "Plugin manifest schema, lifecycle hooks, and API surface."
---

# Plugins reference

## Manifest schema

```json
{
  "name": "string (required)",
  "version": "string (semver, required)",
  "description": "string",
  "entry": "string (path to entry point)",
  "tools": ["string (tool names)"],
  "hooks": ["string (event names)"],
  "env": {
    "<VAR_NAME>": {
      "description": "string",
      "required": "boolean"
    }
  }
}
```

## Plugin context API

```typescript
interface PluginContext {
  // Tool registration
  registerTool(definition: ToolDefinition): void

  // Lifecycle hooks
  onSessionStart(handler: (session: SessionInfo) => Promise<void>): void
  onSessionEnd(handler: (session: SessionInfo) => Promise<void>): void
  onTurnStart(handler: (turn: TurnInfo) => Promise<void>): void
  onTurnComplete(handler: (turn: TurnInfo) => Promise<void>): void

  // Configuration
  getConfig(): Record<string, unknown>
  getEnv(key: string): string | undefined
}
```

## Tool definition

```typescript
interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
  execute: (params: Record<string, unknown>) => Promise<ToolResult>
}
```

## Loading order

1. Global plugins (`~/.liteai/plugins/`)
2. Project plugins (`.liteai/plugins/`)
3. Config plugins (`settings.json → plugins[]`)
4. Runtime plugins (`LITEAI_PLUGIN_DIR`)
