# Implementation Plan — Phase 6B: Commands, Diagnostics & Polish

> **Scope**: Slash command sweep, MCP dialog enhancements, diagnostics, Phase 7 polish
> **Packages touched**: `packages/cli` (TUI components, keybindings), minor `packages/core` (doctor route)
> **Prerequisite**: Phase 6A complete (search & memory implemented)
> **Companion doc**: [analysis_and_questions.md](./analysis_and_questions.md)

---

## 6.4 — Slash Command Sweep

Register missing slash commands that already have backend support or dialog infrastructure.

### 6.4.1 — `/export` Command

The export dialog already exists at `dialog-export-options.tsx`. It just needs wiring.

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

Add to `TUI_COMMANDS`:
```typescript
{ name: "export", description: "Export session transcript to a file", template: "", hints: [] },
```

Add to `tuiInterceptors`:
```typescript
export: () => {
  const sid = session.sessionID
  if (!sid) return
  dialog.push(() => (
    <DialogExportOptions
      defaultFilename={`liteai-session-${sid.slice(0, 8)}.md`}
      defaultThinking={false}
      defaultToolDetails={true}
      defaultAssistantMetadata={false}
      defaultOpenWithoutSaving={false}
      onConfirm={async (opts) => {
        // Fetch messages, format as markdown, write to file
        const messages = sync.message[sid] ?? []
        const parts = sync.part
        const content = formatSessionExport(messages, parts, opts)
        if (opts.openWithoutSaving) {
          await openInEditor(content)
        } else {
          await writeFile(opts.filename, content, "utf-8")
          toast.show({ variant: "success", message: `Exported to ${opts.filename}` })
        }
        dialog.pop()
      }}
      onCancel={() => dialog.pop()}
    />
  ))
},
```

#### [NEW] `packages/cli/src/tui/hooks/use-session-export.ts`

Markdown formatter for session export:

```typescript
export function formatSessionExport(
  messages: Message.Info[],
  parts: Record<string, Part[]>,
  options: { thinking: boolean; toolDetails: boolean; assistantMetadata: boolean }
): string {
  const lines: string[] = ["# LiteAI Session Export\n"]
  for (const msg of messages) {
    const role = msg.role === "user" ? "## User" : "## Assistant"
    lines.push(`${role}\n`)
    const msgParts = parts[msg.id] ?? []
    for (const part of msgParts) {
      if (part.type === "text") {
        lines.push(part.state.text ?? "")
      }
      if (part.type === "thinking" && options.thinking) {
        lines.push(`> *Thinking:* ${part.state.text ?? ""}`)
      }
      if (part.type === "tool" && options.toolDetails) {
        lines.push(`\`\`\`\n${part.tool}: ${JSON.stringify(part.state.input, null, 2)}\n\`\`\``)
      }
    }
    if (options.assistantMetadata && msg.role === "assistant") {
      lines.push(`\n*Model: ${msg.model ?? "unknown"} | Tokens: ${msg.tokens ?? "?"}}*\n`)
    }
    lines.push("---\n")
  }
  return lines.join("\n")
}
```

### 6.4.2 — `/plan` Command

Toggle plan mode. Core already has `PlanModeState` and the backend route.

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

Add to `TUI_COMMANDS`:
```typescript
{ name: "plan", description: "Toggle plan mode (think before acting)", template: "", hints: [] },
```

Add to `tuiInterceptors`:
```typescript
plan: () => {
  const sid = session.sessionID
  if (!sid) return
  // Toggle plan mode via SDK
  void sdk.client.project.session.planMode.toggle({ sessionID: sid, projectID: sdk.projectID })
  toast.show({ variant: "info", message: "Plan mode toggled" })
},
```

> **Note**: Verify the exact SDK client method path. Look at `packages/sdk/src/client/` for the plan mode route binding. If no dedicated toggle endpoint exists, use the session update route with `toolProfile: "Plan"` or `toolProfile: undefined`.

### 6.4.3 — `/effort` Command

Set model effort level (low, medium, high).

#### [NEW] `packages/cli/src/tui/components/dialog-effort.tsx`

```tsx
export function DialogEffort(): React.ReactNode {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()

  const options = [
    { value: "low", title: "Low", description: "Fast, concise responses" },
    { value: "medium", title: "Medium", description: "Balanced quality and speed" },
    { value: "high", title: "High", description: "Thorough, detailed responses" },
  ]

  return (
    <DialogSelect
      title="Set Effort Level"
      options={options}
      onSelect={async (option) => {
        await sdk.client.project.config.update({
          projectID: sdk.projectID,
          effort: option.value,
        })
        toast.show({ variant: "success", message: `Effort set to ${option.value}` })
        dialog.pop()
      }}
      footerContent={<Text color={theme.textMuted}>↑↓ navigate · Enter select · Esc cancel</Text>}
    />
  )
}
```

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

```typescript
// TUI_COMMANDS:
{ name: "effort", description: "Set model effort level", template: "", hints: [] },

// tuiInterceptors:
effort: () => dialog.push(() => <DialogEffort />),
```

### 6.4.4 — `/permissions` Command

Display current permission rules and overrides.

#### [NEW] `packages/cli/src/tui/components/dialog-permissions.tsx`

```tsx
export function DialogPermissions(): React.ReactNode {
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const sessionID = useSession().sessionID

  const permissions = useMemo(() => {
    return sync.permission[sessionID ?? ""] ?? []
  }, [sync.permission, sessionID])

  // Group by tool name
  const grouped = useMemo(() => {
    const map = new Map<string, typeof permissions>()
    for (const p of permissions) {
      const tool = p.tool?.name ?? "unknown"
      if (!map.has(tool)) map.set(tool, [])
      map.get(tool)!.push(p)
    }
    return Array.from(map.entries())
  }, [permissions])

  const options = grouped.map(([tool, perms]) => ({
    value: tool,
    title: tool,
    description: `${perms.length} pending`,
  }))

  return (
    <DialogSelect
      title="Permissions"
      header={<Text color={theme.textMuted}>{permissions.length} pending approvals</Text>}
      options={options}
      onSelect={() => {}} // View-only for now
      footerContent={<Text color={theme.textMuted}>↑↓ navigate · Esc close</Text>}
    />
  )
}
```

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

```typescript
// TUI_COMMANDS:
{ name: "permissions", description: "View pending permission requests", template: "", hints: [] },

// tuiInterceptors:
permissions: () => dialog.push(() => <DialogPermissions />),
```

---

## 6.5 — Diagnostics (`/doctor`)

System health check command.

### Design

Checks:
1. Bun version and runtime
2. LiteAI version (from package.json)
3. Ripgrep availability (`rg --version`)
4. Git availability (`git --version`)
5. Active MCP servers and their status
6. Configuration file locations and validity
7. SQLite database health
8. Available providers and model counts

### Files

#### [NEW] `packages/core/src/server/routes/diagnostics.ts`

```typescript
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { Instance } from "../../project/instance"

const DiagnosticResult = z.object({
  name: z.string(),
  status: z.enum(["ok", "warn", "error"]),
  message: z.string(),
  details: z.string().optional(),
})

export const DiagnosticRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Run diagnostics",
      description: "Run system health checks and return diagnostic results.",
      operationId: "project.diagnostics",
      responses: {
        200: {
          description: "Diagnostic results",
          content: { "application/json": { schema: resolver(DiagnosticResult.array()) } },
        },
      },
    }),
    async (c) => {
      const checks = await runDiagnostics()
      return c.json(checks)
    },
  ),
)

async function runDiagnostics(): Promise<z.infer<typeof DiagnosticResult>[]> {
  const results: z.infer<typeof DiagnosticResult>[] = []

  // 1. Runtime
  results.push({
    name: "Runtime",
    status: "ok",
    message: `Bun ${Bun.version}`,
  })

  // 2. Ripgrep
  try {
    const proc = Bun.spawn(["rg", "--version"], { stdout: "pipe" })
    const output = await new Response(proc.stdout).text()
    results.push({ name: "Ripgrep", status: "ok", message: output.trim().split("\n")[0] })
  } catch {
    results.push({ name: "Ripgrep", status: "error", message: "Not found in PATH" })
  }

  // 3. Git
  try {
    const proc = Bun.spawn(["git", "--version"], { stdout: "pipe" })
    const output = await new Response(proc.stdout).text()
    results.push({ name: "Git", status: "ok", message: output.trim() })
  } catch {
    results.push({ name: "Git", status: "warn", message: "Not found in PATH" })
  }

  // 4. Project directory
  results.push({
    name: "Project",
    status: "ok",
    message: Instance.directory,
  })

  // 5-8: Add MCP, config, DB, provider checks...
  // (Pattern is the same: try/catch, push result)

  return results
}
```

#### [MODIFY] `packages/core/src/server/routes/global.ts` (or create new mount point)

Mount the diagnostics route:
```diff
+ import { DiagnosticRoutes } from "./diagnostics"

  // In the Hono app:
+ .route("/diagnostics", DiagnosticRoutes())
```

#### [NEW] `packages/cli/src/tui/components/dialog-doctor.tsx`

```tsx
export function DialogDoctor(): React.ReactNode {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [results, setResults] = useState<DiagResult[] | null>(null)

  useEffect(() => {
    sdk.fetch(`${sdk.url}/diagnostics`)
      .then(r => r.json())
      .then(setResults)
      .catch(() => setResults([]))
  }, [sdk])

  if (!results) return <LoadingState label="Running diagnostics…" />

  const statusIcon = (s: string) =>
    s === "ok" ? "✓" : s === "warn" ? "⚠" : "✗"
  const statusColor = (s: string) =>
    s === "ok" ? theme.success : s === "warn" ? theme.warning : theme.error

  return (
    <DialogSelect
      title="Doctor — System Diagnostics"
      skipFilter
      options={results.map(r => ({
        value: r.name,
        title: `${statusIcon(r.status)} ${r.name}`,
        description: r.message,
      }))}
      footerContent={
        <Text color={theme.textMuted}>
          {results.filter(r => r.status === "error").length} errors ·
          {results.filter(r => r.status === "warn").length} warnings ·
          {results.filter(r => r.status === "ok").length} ok
        </Text>
      }
    />
  )
}
```

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

```typescript
// TUI_COMMANDS:
{ name: "doctor", description: "Run system diagnostics", template: "", hints: [] },

// tuiInterceptors:
doctor: () => dialog.push(() => <DialogDoctor />),
```

---

## 6.6 — MCP Dialog Enhancements

Improve the existing `dialog-mcp.tsx` with auth flow handling and tool descriptions.

### Files

#### [MODIFY] `packages/cli/src/tui/components/dialog-mcp.tsx`

Enhancements to `McpDetail`:

1. **Auth flow handling** — When status is `needs_auth` or `needs_client_registration`, show an "Authenticate" action that opens the auth URL in the browser:

```diff
  const options = useMemo(
    () => [
+     ...(mcpStatus?.status === "needs_auth" || mcpStatus?.status === "needs_client_registration"
+       ? [{
+           value: "authenticate",
+           title: "Authenticate",
+           disabled: false,
+         }]
+       : []),
      {
        value: "tools",
        title: "View tools",
        disabled: !enabled,
      },
      // ... existing options
    ],
    [enabled, mcpStatus],
  )
```

In `onSelect`:
```diff
+ } else if (option.value === "authenticate") {
+   const authUrl = mcpStatus?.authUrl
+   if (authUrl) {
+     // Open in system browser
+     const { exec } = await import("node:child_process")
+     exec(`open "${authUrl}"`) // Cross-platform: use 'start' on Windows, 'xdg-open' on Linux
+   }
```

2. **Tool descriptions** — Enhance `McpToolsList` to show tool descriptions when available:

```diff
- const options = useMemo(() => {
-   return tools.map((t) => ({
-     title: t,
-     value: t,
-   }))
- }, [tools])
+ const options = useMemo(() => {
+   return tools.map((t) => ({
+     title: typeof t === "string" ? t : t.name,
+     value: typeof t === "string" ? t : t.name,
+     description: typeof t === "string" ? undefined : t.description,
+   }))
+ }, [tools])
```

> **Note**: Check what the `/mcp/tools` endpoint actually returns. If it's just `string[]`, we need to enhance the core route to include descriptions. If it's already `{ name: string, description: string }[]`, just update the types.

3. **Error display** — When an MCP server has `status: "failed"`, show the error message in the detail view header:

```diff
  {isFailed && mcpStatus?.error && (
    <Text>
      <Text color={theme.error as Color} bold>Error: </Text>
      <Text color={theme.textMuted as Color}>{mcpStatus.error}</Text>
    </Text>
  )}
```

---

## 7.0 — Phase 7 Polish

### 7.1 — Error Verbosity Control

Add a setting to control how much detail tool errors show.

#### [MODIFY] `packages/cli/src/tui/context/tui-config.tsx`

Add `errorVerbosity` to the TUI config:

```diff
  export type TuiConfig = {
    vimMode: boolean
    displayMode: "compact" | "transcript"
+   errorVerbosity: "low" | "full"
  }
```

#### [MODIFY] `packages/cli/src/tui/routes/session/tools.tsx`

In `InlineTool` and `BlockTool`, check `errorVerbosity`:

```diff
+ const config = useTuiConfig()
  const error = props.part.state.status === "error" ? props.part.state.error : undefined
+ const displayError = error && config.errorVerbosity === "low"
+   ? error.split("\n")[0] // First line only
+   : error
```

#### [MODIFY] `packages/cli/src/tui/components/dialog-settings.tsx`

Add error verbosity toggle to settings dialog.

### 7.2 — Help Dialog Updates

Update the help dialog to include all new commands and keybindings.

#### [MODIFY] `packages/cli/src/tui/components/dialog-help-v2.tsx`

No code change needed — help dialog dynamically reads from `TUI_COMMANDS` and `sync.command`. All new commands added to `TUI_COMMANDS` will automatically appear. Verify this works by testing after adding all new commands.

### 7.3 — Status Line Enhancements

#### [MODIFY] `packages/cli/src/tui/components/status-line.tsx`

Add plan mode indicator and effort level to the status line:

```diff
+ {sync.planMode && (
+   <Text color={theme.warning}> 📋 Plan</Text>
+ )}
+ {sync.effort && sync.effort !== "medium" && (
+   <Text color={theme.textMuted}> ⚡{sync.effort}</Text>
+ )}
```

---

## Summary — New Files Created

| File | Package | Purpose |
|------|---------|---------|
| `transcript-search.tsx` | cli | In-session message search bar |
| `dialog-search.tsx` | cli | Global workspace search dialog |
| `dialog-memory.tsx` | cli | Memory file browser |
| `dialog-effort.tsx` | cli | Effort level picker |
| `dialog-permissions.tsx` | cli | Permission overview |
| `dialog-doctor.tsx` | cli | Diagnostics viewer |
| `use-debounced-value.ts` | cli | Debounce hook |
| `use-session-export.ts` | cli | Session export formatter |
| `use-memory-files.ts` | cli | Memory file discovery |
| `fts.ts` | core | FTS5 virtual table for cross-session search |
| `diagnostics.ts` | core | Diagnostics route |

## Summary — Modified Files

| File | Changes |
|------|---------|
| `prompt-input.tsx` | +7 TUI_COMMANDS, +7 tuiInterceptors |
| `default-bindings.ts` | +3 keybindings (ctrl+f, ctrl+shift+f, ctrl+x m) |
| `session-layout.tsx` | Transcript search integration |
| `virtual-message-list.tsx` | Expose scrollToMessage |
| `dialog-mcp.tsx` | Auth flow, tool descriptions, error display |
| `dialog-session-list.tsx` | FTS search integration |
| `file.ts` (core route) | Enhanced /find params |
| `session.ts` (core route) | New /search route |
| `persister.ts` or `persistence-writer.ts` | FTS indexing hook |
| `db.ts` (core) | FTS initialization |
| `global.ts` (core routes) | Diagnostics mount |
| `tui-config.tsx` | Error verbosity setting |
| `tools.tsx` (session route) | Error verbosity rendering |
| `dialog-settings.tsx` | Verbosity toggle |
| `status-line.tsx` | Plan mode + effort indicators |

## Verification Plan

### Automated
```bash
cd packages/core && bun typecheck
cd packages/cli && bun typecheck
bun lint:fix
cd packages/core && bun test test/session test/storage
```

### Manual Testing Checklist
- [ ] `/export` → opens export dialog → writes file
- [ ] `/plan` → toggles plan mode → status line updates
- [ ] `/effort` → opens picker → changes effort
- [ ] `/permissions` → shows pending permissions
- [ ] `/doctor` → runs diagnostics → shows results
- [ ] `/memory` → lists memory files → opens in editor
- [ ] MCP dialog → auth servers show "Authenticate" action
- [ ] MCP tools list → shows descriptions
- [ ] Error verbosity toggle → tool errors switch between full/summary
- [ ] All new commands appear in `/help`
