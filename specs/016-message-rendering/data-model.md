# Data Model: Message Rendering & Error Resilience

**Date**: 2026-05-21
**Branch**: `016-message-rendering`

## Entities

### ToolDisplayStatus (Enum)

The 6-state display model for tool call rendering. This is a **display-layer concept** — it does NOT modify the core SDK's `ToolState`.

```
┌──────────────┐
│   Pending    │  (core: pending)
│     ○        │
└──────┬───────┘
       │
┌──────▼───────┐      ┌──────────────┐
│  Executing   │──────▶  Confirming  │  (derived from permission request)
│  ⠋ spinner   │      │      ?       │
└──────┬───────┘      └──────┬───────┘
       │                     │
       │          ┌──────────┼──────────┐
       │          │                     │
┌──────▼───────┐  │  ┌──────▼───────┐  │
│   Success    │  │  │  Cancelled   │  │
│     ✓        │  │  │      –       │  │
└──────────────┘  │  │ strikethrough│  │
                  │  └──────────────┘  │
            ┌─────▼────────┐           │
            │    Error     │◀──────────┘
            │     ✗        │
            └──────────────┘
```

| State | Icon | Color | Strikethrough | Source |
|-------|------|-------|---------------|--------|
| Pending | `○` | `theme.success` | No | `part.state.status === "pending"` |
| Executing | spinner | `theme.text` | No | `part.state.status === "running"` |
| Success | `✓` | `theme.success` | No | `part.state.status === "completed"` |
| Confirming | `?` | `theme.warning` | No | Permission pending for `part.callID` |
| Cancelled | `–` | `theme.warning` | Yes | Error contains "rejected permission" / "user dismissed" / "specified a rule" |
| Error | `✗` | `theme.error` | No | `part.state.status === "error"` AND not cancelled |

### ViewParts (Interface)

The output of every tool formatter function. Consumed by `DenseToolMessage`.

| Field | Type | Description |
|-------|------|-------------|
| `description` | `React.ReactNode \| undefined` | Muted text after tool name (e.g., file path, command, query) |
| `summary` | `React.ReactNode \| undefined` | Result summary with `→` prefix (e.g., "→ Accepted (+12, -3)") |
| `payload` | `React.ReactNode \| undefined` | Expandable content below the tool line (diff, shell output, Q&A) |

### ToolFormatterRegistry (Record)

Maps tool names to formatter functions that produce `ViewParts`.

```
Record<string, (input, metadata, output, part) => ViewParts>
```

| Tool Name | Description Source | Summary Source | Payload |
|-----------|-------------------|----------------|---------|
| `read` | `input.filePath` | loaded files count | None |
| `write` | `input.filePath` | "Accepted" + diagnostics | Code content / diff |
| `edit` | `input.filePath` | "Accepted" + diff stats | Structured diff |
| `glob` | `input.pattern` + path | match count | None |
| `grep` | `input.pattern` + path | match count | None |
| `list` | `input.path` | None | None |
| `webfetch` | `input.url` | None | None |
| `codesearch` | `input.query` | result count | None |
| `websearch` | `input.query` | result count | None |
| `run_command` | `input.command` + cwd | exit code + duration | `ShellOutput` component |
| `command_status` | command ID | status text | Output text |
| `send_command_input` | command ID | None | Output text |
| `apply_patch` | file count | file list | Structured diffs per file |
| `task` | `input.description` | toolcall count | None |
| `ask_user` | questions (pending) / hidden (completed) | answers | Q&A block |
| `todowrite` | "Todos" | item count | Checklist items |
| `skill` | `input.name` | None | None |
| (default) | `formatInput(input)` | output preview | Full output |

### Toast Notification (Simplified)

Current: Multiple stacked toasts in bordered boxes.
New: Single inline text, most recent wins.

| Field | Type | Change |
|-------|------|--------|
| `message` | `string` | Unchanged |
| `variant` | `ToastVariant` | Unchanged |
| `duration` | `number` | Unchanged (default 3000ms) |
| `title` | `string \| undefined` | Keep but rarely used |

Rendering: No borders, no padding, no stacking. Single `<Text color={variantColor}>{icon} {message}</Text>` in the footer.

### ErrorMessage / WarningMessage (New Components)

Persistent messages in the conversation history. Not toast.

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Error/warning text |
| `prefix` | `string` | `✗` (error) or `⚠` (warning) |
| `color` | `string` | `theme.error` or `theme.warning` |

## State Transitions

### Tool Lifecycle
```
pending → running → completed
pending → running → error (system failure)
pending → running → error (user cancelled) → mapped to "Cancelled" display state
pending → running + permission asked → "Confirming" display state
                                     → permission granted → running continues → completed
                                     → permission denied → error ("rejected permission") → mapped to "Cancelled"
```

### Toast Lifecycle
```
show(options) → render inline → setTimeout(3s) → remove
show(new) while existing → replace (not stack)
```

## Relationships

```
ToolPartView (parts.tsx)
  ├─ reads ToolPart from app state
  ├─ reads PermissionRequest[] from app state
  ├─ calls mapToolPartToDisplayStatus(part, permissions) → ToolDisplayStatus
  ├─ calls getToolViewParts(toolName, input, metadata, output, part) → ViewParts
  └─ renders DenseToolMessage(status, name, viewParts, part)
       ├─ ToolStatusIndicator(status)
       └─ payload (from ViewParts)

AppStateProvider (app-state-context.tsx)
  ├─ receives session.error event
  ├─ attaches error to assistant message (for ErrorRecoveryHint)
  └─ calls onSessionError → toastShow (ephemeral feedback only)
```
