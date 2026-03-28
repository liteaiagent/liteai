# LiteAI Command Architecture

## Overview

There are **two completely separate command systems** that coexist and are both surfaced to the user through the `/` autocomplete. Conflating them is the most common source of confusion:

| | **Server Commands** | **TUI Commands** |
|---|---|---|
| Defined in | [src/command/index.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts) | [useCommandDialog](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#113-120) registrations |
| Lives in | Backend process | TUI / Web App renderer |
| Executed by | AI model (LLM call) | UI directly (no LLM) |
| Triggered via | Typing `/cmd args` → sent as a message | Typing `/cmd` → selected in autocomplete |
| Has template | ✅ yes – becomes the user message | ❌ no – runs JS immediately |
| Exposed via API | `sdk.client.command.list()` | Never; local to TUI |
| Has keybind | ❌ not applicable | ✅ optionally |

---

## 1. Server Commands

### 1.1 Definition — `Command.Info`

Every server command is an object conforming to `Command.Info` (defined in [src/command/index.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts)):

```ts
type Command.Info = {
  name: string
  description?: string
  agent?: string         // override agent for execution
  model?: string         // override model for execution
  source?: "command" | "mcp" | "skill"
  template: string | Promise<string>  // the prompt injected into the session
  subtask?: boolean
  hints: string[]        // e.g. ["$1", "$ARGUMENTS"]
}
```

The [template](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#368-371) is the **actual text sent as a user message** to the AI model. It may contain:
- `$1`, `$2`, … – positional argument substitutions
- `$ARGUMENTS` – full argument string substitution
- `` !`shell cmd` `` – shell expressions that are evaluated before sending

### 1.2 Where Commands Are Registered

All server commands are collected inside a single `Instance.state()` callback in `Command.state`:

```
src/command/index.ts → Command.state()
```

Reload happens automatically whenever `Instance.dispose()` is called (e.g., when plugins change).

#### a) Built-in Commands (`source: "command"`)

| Name | Description |
|---|---|
| [init](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#31-112) | Creates/updates `AGENTS.md` using the `initialize.txt` template |
| `review` | Reviews git changes; sets `subtask: true` |
| `hooks` | Lists configured hooks by calling `Hook.list()` |
| [plugin](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#68-128) | Full plugin manager: list/install/uninstall/enable/disable/update/marketplace |

The [plugin](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#68-128) command is the most complex — its [template](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#368-371) getter calls [pluginCommand(args)](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#68-128) lazily, which is passed `Command.Default._pluginArgs` set just before template access during invocation. See §2 on invocation for details.

#### b) User Config Commands (`source: "command"`)

Any command defined in `settings.json` under the [command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214) key:

```json
{
  "command": {
    "my-cmd": {
      "description": "My custom command",
      "template": "Do something with $ARGUMENTS",
      "agent": "coder",
      "subtask": false
    }
  }
}
```

These are iterated and added to the result map verbatim.

#### c) MCP Prompt Commands (`source: "mcp"`)

MCP servers can expose **prompts**. These are fetched via `MCP.prompts()` and each becomes a server command whose [template](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#368-371) getter calls `MCP.getPrompt(...)` lazily (async). Arguments from MCP prompt definitions become `$1`, `$2`, …

#### d) Skill Commands (`source: "skill"`)

Skills whose `user_invocable` is not `false` are promoted to server commands. See §1.3 below for the full skill discovery pipeline.

---

### 1.3 How Skills Become Commands

#### Step 1 — Skill Discovery (`Skill.state`)

`Skill.state` (in [src/skill/skill.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/skill/skill.ts)) is also an `Instance.state()` callback run at startup or on reload. It scans for `SKILL.md` files in this priority order (later entries override earlier):

1. **Global external dirs** – `~/.claude/skills/**/SKILL.md`, `~/.agents/skills/**/SKILL.md`
2. **Project external dirs** – same patterns walking up from `Instance.directory` to `Instance.worktree`
3. **Config dirs** – `<liteai-config-dir>/{skill,skills}/**/SKILL.md`
4. **Config `skills.paths`** – any extra dirs specified in settings
5. **URL-pulled skills** – downloaded from `skills.urls` in settings
6. **Bundled skills** – shipped with the binary (lowest priority, skipped if name already exists)
7. **Plugin skills** – collected by the plugin loader from `--plugin-dir` and registry plugins via `Config.pluginSkills()`

Each `SKILL.md` is parsed as a Markdown file with YAML frontmatter. Key frontmatter fields:

| Field | Effect |
|---|---|
| `name` | Command name (e.g. `skill-creator`) |
| `description` | Shown in autocomplete |
| `user_invocable: false` | Excluded from command list (background knowledge only) |
| `argument_hint` | Becomes the [hints](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/command/index.ts#48-57) array entry |
| `disable_model_invocation` | Prevents model from invoking this skill |
| `agent` | Override agent used when skill is invoked |
| `model` | Override model used when skill is invoked |
| `context: "fork"` | Runs the skill in a forked session context |

#### Step 2 — Promotion to Command (`Command.state`)

Inside `Command.state`, after all other sources are registered:

```ts
for (const skill of await Skill.all()) {
  if (result[skill.name]) continue              // don't overwrite built-ins or config
  if (skill.user_invocable === false) continue  // background knowledge, skip
  result[skill.name] = {
    name: skill.name,
    description: skill.description,
    source: "skill",
    get template() { return skill.content },    // the markdown body is the prompt
    hints: skill.argument_hint ? [skill.argument_hint] : [],
  }
}
```

So a skill's **markdown body** becomes the AI prompt template.

#### Step 3 — Exposed via API

`Command.list()` returns `Object.values(state)` — all sources combined. The TUI fetches this on bootstrap via `sdk.client.command.list()`.

---

### 1.4 Server Command Invocation

When the user types `/cmd arg1 arg2` and submits, the prompt is parsed and routed through:

```
src/session/prompt/command.ts → command(input: CommandInput)
```

The flow:

1. `Command.get(input.command)` looks up the `Command.Info`
2. Positional arguments (`$1`, `$2`) and `$ARGUMENTS` are substituted into `cmd.template`
3. For the special `/plugin` command: `Command.Default._pluginArgs` is set to `input.arguments` before accessing `cmd.template` (because the getter is synchronous but reads this mutable variable)
4. Shell expressions `` !`...` `` inside the substituted template are executed via Bun's `$` shell
5. If `cmd.subtask === true` (or the agent is non-primary), the command is wrapped as a `subtask` message part
6. If `cmd.source === "skill"`, metadata ([command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214), `arguments`, `description`) is attached to the text part
7. The `command.execute.before` plugin hook fires
8. The resulting message parts are submitted to the session AI loop via `prompt(...)`
9. On completion, `Command.Event.Executed` is published to the bus

---

## 2. TUI Commands

### 2.1 Registration — [useCommandDialog](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#113-120)

TUI commands are created entirely in the renderer process. Any component (or hook) calls:

```ts
const command = useCommandDialog()
command.register(() => [
  {
    title: "Rename session",
    value: "session.rename",
    keybind: "session_rename",
    category: "Session",
    slash: { name: "rename" },  // ← makes it appear in "/" autocomplete
    onSelect: (dialog) => { /* runs immediately, no AI involved */ },
  }
])
```

The context ([CommandProvider](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#121-139) / [useCommandDialog](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#113-120)) lives entirely in the TUI process — it never touches the server.

### 2.2 How TUI Slash Commands Appear in Autocomplete

The [Autocomplete](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/prompt/autocomplete.tsx#66-673) component reads two sources when the user types `/`:

1. **TUI slashes** — `command.slashes()` returns all registered [CommandOption](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#23-30)s that have a [slash](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#83-95) field  
2. **Server commands** — `sync.data.command` (fetched from the server on bootstrap)

They are merged with deduplication: if a server command has the same name as a TUI slash command, the TUI one wins:

```ts
const commands = createMemo((): AutocompleteOption[] => {
  // 1. TUI commands first
  const results = [...command.slashes()]
  const seen = new Set(results.map((r) => r.display.trimEnd()))

  // 2. Server commands — add only if not already seen
  for (const serverCommand of sync.data.command) {
    const label = serverCommand.source === "mcp" ? ":mcp"
                : serverCommand.source === "skill" ? ":skill" : ""
    const display = `/${serverCommand.name}${label}`
    if (seen.has(display) || seen.has(`/${serverCommand.name}`)) continue
    results.push({ display, ... })
  }
  return results
})
```

Selecting a **TUI slash** calls [onSelect()](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/pages/layout/commands.ts#254-255) immediately (e.g., opens a dialog).  
Selecting a **server command** inserts `/name ` into the prompt textarea — you then submit to trigger the AI.

### 2.3 How TUI Commands Are Triggered

Three ways:
- **Keybind** — `useKeyboard` in [CommandProvider](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#121-139) matches any registered [keybind](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/context/command.tsx#406-420)
- **Command palette** — opened with `command_list` keybind; uses `DialogSelect`
- **Slash autocomplete** — typing `/name` and pressing Enter/Tab

---

## 3. Complete Command Catalogues

### 3.1 Server Commands (built-in)

These always exist. Plugins and config may add more.

| Slash | Source | Description |
|---|---|---|
| `/init` | [command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214) | Create/update `AGENTS.md` |
| `/review` | [command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214) | Review git changes (subtask) |
| `/hooks` | [command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214) | List configured hooks |
| `/plugin` | `skill` | Plugin manager (install/uninstall/enable/disable/update/marketplace) |
| any user-config key | [command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214) | Whatever is in `settings.json → command` |
| any MCP prompt | `mcp` | Displayed with `:mcp` label in TUI |
| any `user_invocable` skill | `skill` | Displayed with `:skill` label in TUI |

> [!NOTE]
> The `/plugin` command has `source: "skill"` even though it is built-in, so it shows the `:skill` badge. This is intentional — the badge helps distinguish it from plain [command](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/session/prompt/command.ts#51-214) sources.

### 3.2 TUI-Only Slash Commands — Global ([app.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/app.tsx))

Registered in `src/cli/cmd/tui/app.tsx`. Always available regardless of route.

| Slash | Value | Category | Description |
|---|---|---|---|
| `/sessions`, `/resume`, `/continue` | `session.list` | Session | Open session switcher dialog |
| `/new`, `/clear` | `session.new` | Session | New session (carries current prompt) |
| `/workspaces` | `workspace.list` | Workspace | Manage workspaces (experimental flag) |
| `/models` | `model.list` | Agent | Open model picker dialog |
| `/agents` | `agent.list` | Agent | Open agent picker dialog |
| `/mcp` | `mcp.list` | Agent | Toggle MCPs dialog |
| `/plugin`, `/plugins` | `plugin.manage` | Agent | Open plugin management dialog |
| `/reload-plugins` | `plugins.reload` | Agent | Calls `sdk.client.instance.dispose()` — no LLM involved |
| `/connect` | `provider.connect` | Provider | Open provider connection dialog |
| `/status` | `liteai.status` | System | View system status dialog |
| `/themes` | `theme.switch` | System | Open theme switcher dialog |
| `/help` | `help.show` | System | Open help dialog |
| `/exit`, `/quit`, `/q` | `app.exit` | System | Exit the app |

> [!NOTE]
> `/agents` lives here — it opens `DialogAgent` immediately as a pure UI action. It is **not** a server command. There is no LLM call involved.

> [!NOTE]
> `/plugin` is registered here as a TUI command (opens `DialogPlugin`) **and** exists as a server command. The TUI version wins due to deduplication, so it opens a UI dialog in the TUI rather than invoking the AI.

### 3.3 TUI-Only Slash Commands — Session Route ([commands.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/routes/session/commands.tsx))

Registered in `src/cli/cmd/tui/routes/session/commands.tsx`. Only active while viewing a session.

| Slash | Value | Description |
|---|---|---|
| `/share` | `session.share` | Share/copy share link |
| `/rename` | `session.rename` | Rename the session |
| `/timeline` | `session.timeline` | Jump to a message |
| `/fork` | `session.fork` | Fork from a message |
| `/compact`, `/summarize` | `session.compact` | Summarize/compact session |
| `/unshare` | `session.unshare` | Unshare a session |
| `/undo` | `session.undo` | Undo previous message |
| `/redo` | `session.redo` | Redo reverted message |
| `/timestamps`, `/toggle-timestamps` | `session.toggle.timestamps` | Toggle timestamp display |
| `/thinking`, `/toggle-thinking` | `session.toggle.thinking` | Toggle thinking display |
| `/copy` | `session.copy` | Copy session transcript |
| `/export` | `session.export` | Export session transcript |


### 3.4 TUI-Only Slash Commands — Prompt ([prompt/index.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/prompt/index.tsx))

Registered in `src/cli/cmd/tui/component/prompt/index.tsx`. Active whenever the prompt component is mounted.

| Slash | Value | Description |
|---|---|---|
| `/editor` | `prompt.editor` | Open current prompt in `$EDITOR` |
| `/skills` | `prompt.skills` | Browse and select a skill to invoke |

### 3.5 Web App Commands (command palette, `Ctrl/Cmd+Shift+P`)

Registered in [packages/web/src/pages/layout/commands.ts](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/pages/layout/commands.ts). These are entirely client-side.  
The web app does **not** use [useCommandDialog](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/core/src/cli/cmd/tui/component/dialog-command.tsx#113-120) from the TUI — it has its own [useCommand](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/web/src/context/command.tsx) context with the same concept but different implementation. Server commands are only accessible in the web app by typing `/name` in the chat prompt and submitting.

| Slash | ID | Description |
|---|---|---|
| `/settings` | `settings.open` | Open Settings → General (`Mod+,`) |
| `/mcp` | `settings.open.mcp` | Open Settings → MCP |
| `/plugin` | `settings.open.plugins` | Open Settings → Plugins (UI dialog) |
| `/workspace` | `workspace.toggle` | Toggle git workspaces |
| *(none)* | `sidebar.toggle` | Toggle sidebar (`Mod+B`) |
| *(none)* | `session.archive` | Archive session (`Mod+Shift+Backspace`) |
| *(none)* | `theme.cycle` | Cycle themes (`Mod+Shift+T`) |
| *(none)* | `theme.scheme.cycle` | Cycle color schemes (`Mod+Shift+S`) |

---

## 4. Data Flow Summary

```
Startup / Instance.dispose()
  │
  ├─ Skill.state()
  │   ├─ scan global/project external dirs (.claude/skills/, .agents/skills/)
  │   ├─ scan config dirs (.liteai/skill/ etc.)
  │   ├─ scan config skills.paths entries
  │   ├─ pull skills from skills.urls
  │   ├─ add bundled skills (lowest priority)
  │   └─ add plugin skills (Config.pluginSkills())
  │
  └─ Command.state()
      ├─ built-ins: init, review, hooks, plugin
      ├─ user config commands (settings.json → command)
      ├─ MCP prompts (MCP.prompts())
      └─ Skill.all() → promote user_invocable skills → source: "skill"

TUI bootstrap (sync.tsx — non-blocking after providers load)
  └─ sdk.client.command.list() → setStore("command", [...])

User types "/" in TUI prompt
  └─ Autocomplete.commands memo
      ├─ TUI slashes (command.slashes()) — take priority, dedup by name
      └─ Server commands (sync.data.command) — labeled :mcp / :skill

  Selecting a TUI slash  → onSelect() fires immediately (UI action)
  Selecting a server cmd → inserts "/name " into textarea, user submits

User submits "/cmd arg1 arg2"
  └─ session/prompt/command.ts → command(input)
      ├─ Command.get(name) → Command.Info
      ├─ substitute $1/$2/$ARGUMENTS into template
      ├─ [plugin only] set _pluginArgs before accessing template getter
      ├─ execute !`shell` expressions in template
      ├─ wrap as subtask if agent is non-primary or subtask:true
      ├─ attach skill metadata if source === "skill"
      ├─ fire command.execute.before plugin hook
      └─ prompt() → AI model call → message stored → Command.Event.Executed published
```
