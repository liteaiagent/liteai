# Plugin Loading & Reload Fix — Session Notes

## Status
Investigation complete. All fixes planned and confirmed. Ready to implement.

---

## Issues Found

### 1. Triple Plugin Loading (Performance Bug) [Fixed]

**Root cause:** Previous session added plugin loading blocks to `agent.ts`, `hook.ts`, and `command/index.ts`. But `config/loader.ts` (lines 185–203) already handles agents/hooks/commands/mcp from enabled plugins via `applyPlugins()`. So plugins are now being loaded **three times** on startup:

1. `config/loader.ts` — for agents, hooks, commands, mcp
2. `skill/skill.ts` — for skills (correct — skills are not part of `applyPlugins`)
3. `agent.ts` + `hook.ts` + `command/index.ts` — **REDUNDANT**, must be removed

**Files to fix:**
- `src/agent/agent.ts` lines 311–353: Remove entire `// Load agents from registry-installed plugins` block
- `src/hook/hook.ts` lines 297–321: Remove entire `// Registry-installed plugin hooks` block in `list()`
- `src/command/index.ts` lines 421–449: Remove entire `// Load commands from registry-installed plugins` block

**Keep:** The block in `src/skill/skill.ts` lines 247–269 — this is the correct location since `applyPlugins()` in `mount.ts` intentionally does NOT apply skills to the config (skills are handled separately).

---

### 2. Plugin Name Shows as "latest" (Cosmetic Bug) [Fixed]

**Root cause:** `cachePath(marketplace, name)` returns a path like:
```
~/.liteai/plugins/cache/anthropics-claude-plugins-official/superpowers/latest/
```
When `loadPlugin()` is called on this path, it sets `plugin.name = path.basename(resolved)` = `"latest"`.

So skills/agents/commands from the `superpowers` plugin are namespaced as `latest:writing-plans` instead of `superpowers:writing-plans`.

**Where it manifests:**
- Skill names in TUI: `latest:writing-skills`, `latest:brainstorming`, etc.
- Skill log: `service=skill plugin=latest name=latest:writing-skills loaded registry plugin skill`

**Fix in `skill.ts`:** Instead of using `plugin.name` for logging, derive the actual plugin name from the registry key. The `enabled` array has entries like `["superpowers@anthropics-claude-plugins-official", true]`. The actual name is `parseRef(key).name` = `"superpowers"`.

The skill names themselves (`skill.name`) come from inside the plugin manifest (already namespaced by `loader.ts` using `plugin.name = basename = "latest"`). The real fix needs to happen in `loader.ts` or the `cachePath` structure. This is a **lower priority** cosmetic issue — skills do load and work, just with unexpected names.

---

### 3. `/reload-plugins` Is Sent to Chat Instead of Executing (Critical Bug)

**Root cause (fully traced):**

The TUI `prompt/index.tsx` (lines 601–607) routes to command execution only if the input starts with `/` AND the command name exists in `sync.data.command`:
```ts
return sync.data.command.some((x) => x.name === command)
```

The `sync.data.command` is populated by `sdk.client.command.list()` which calls `GET /command` → `Command.list()`. The `reload-plugins` command IS in this list, so the TUI should recognize it.

**The real problem:** When `reload-plugins` is selected as a server command and submitted, it eventually calls `Instance.dispose()` mid-session (inside `session/prompt/command.ts` at line 64: `await cmd.template`). This tears down the current instance while the session prompt loop is still running, causing the command to fail silently.

**Why it appears "sent to chat":** When instance is disposed mid-command, the session state is gone. The TUI may show the message that was supposed to be displayed as a command result, but it gets surfaced as a chat message because the session/command context was already torn down.

**The correct fix:**

Add `/reload-plugins` as a **TUI-side slash command** (in the TUI command dialog) that calls `sdk.client.instance.dispose()` directly, bypassing the AI prompt loop entirely. The REST endpoint already exists: `POST /instance/dispose` (server.ts line 263–283).

**Where to add it:** `src/cli/cmd/tui/routes/session/commands.tsx` — add a new entry in the `command.register()` call:
```ts
{
  title: "Reload plugins",
  value: "plugins.reload",
  category: "Plugins",
  slash: { name: "reload-plugins" },
  onSelect: async (dialog: DialogContext) => {
    dialog.clear()
    await sdk.client.instance.dispose({})
    toast.show({ message: "Plugins reloaded", variant: "success" })
  },
},
```

**Also remove** the `[Default.RELOAD_PLUGINS]` entry from `command/index.ts` state (or keep it for non-TUI clients like the web app, since it works fine there through the regular prompt loop).

> **Note:** The existing `POST /instance/dispose` API endpoint (`operationId: "instance.dispose"`) is the backend call. Check if the SDK has a generated binding for `sdk.client.instance.dispose()`. If not, use `sdk.client.fetch("/instance/dispose", { method: "POST" })` or check the SDK bindings in `packages/desktop/src/bindings.ts`.

---

## What Skills DO Work (Confirmed from Logs)

From the server startup logs, skills from enabled plugins ARE being loaded:
```
service=skill name=latest:writing-skills loaded registry plugin skill
service=skill name=latest:brainstorming loaded registry plugin skill
... (15 total skills)
```

The `skill.ts` fix from the previous session works. The user's original complaint about skills not loading may have already been resolved — confirm with the user at the start of the next session.

---

## Files to Change (Summary)

| File | Change |
|------|--------|
| `src/agent/agent.ts` | Remove lines 311–353 (redundant plugin agent loading) |
| `src/hook/hook.ts` | Remove lines 297–321 (redundant plugin hook listing) |
| `src/command/index.ts` | Remove lines 421–449 (redundant plugin command loading) |
| `src/cli/cmd/tui/routes/session/commands.tsx` | Add `reload-plugins` TUI slash command calling `instance.dispose` |
| `src/command/index.ts` | Optionally remove `[Default.RELOAD_PLUGINS]` from state (or keep for web app) |

---

## Key Files Understood

| File | Purpose |
|------|---------|
| `src/config/loader.ts` | Loads all config, calls `applyPlugins()` for agents/hooks/commands/mcp from enabled plugins |
| `src/plugin/mount.ts` | `apply()` merges plugin commands/agents/hooks/mcp into config — but NOT skills |
| `src/skill/skill.ts` | Separately loads skills from `--plugin-dir` and registry — this is correct |
| `src/project/state.ts` | `State.create()` memoizes by directory; `State.dispose()` clears the cache |
| `src/project/instance.ts` | `Instance.dispose()` calls `State.dispose()` to reset all cached state |
| `src/cli/cmd/tui/component/prompt/index.tsx` | Lines 601–607: TUI routes `/command` to `sdk.client.session.command()` if name in `sync.data.command` |
| `src/cli/cmd/tui/component/dialog-command.tsx` | TUI slash command registry — `slash: { name }` makes it appear in `/` autocomplete |
| `src/server/server.ts` | `GET /command` → `Command.list()` feeds `sync.data.command` |
