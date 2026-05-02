# Phase 7A — Tool Rendering Enhancements

> Output File Support (7.1), Subagent Hint Suppression (7.2), MCP Tool Compact Opt-In (7.10)

---

## Prerequisites
- Phase 6B complete (status-line, toast, dialog infra)
- Existing infrastructure: `tools.tsx`, `compact-allowlist.ts`, `ctx.tsx`

## Remote-Mode Constraint
- No `packages/core` filesystem changes. All output file writing done CLI-side via `@liteai/util/fs` (CLI is always local to the user's machine; saved output files are user-local artifacts, not server state).

---

## 7.1 — Output File Support

### Goal
When tool output exceeds a threshold, write it to a local temp file and render the path instead of inlining massive content.

### TUI Schema Change
**File:** `packages/cli/src/cli/config/tui-schema.ts`

Add to `TuiOptions`:
```ts
output_file_threshold: z
  .number()
  .min(100)
  .optional()
  .describe("Character count above which tool output is saved to a file instead of rendered inline (default: 5000)")
```

### Output File Writer
**File [NEW]:** `packages/cli/src/tui/util/output-file.ts`

```ts
import os from "node:os"
import path from "node:path"
import { Fs as Filesystem } from "@liteai/util/fs"

const OUTPUT_DIR = path.join(os.tmpdir(), "liteai-output")

export async function writeOutputFile(opts: {
  sessionID: string
  callID: string
  content: string
}): Promise<string> {
  const dir = path.join(OUTPUT_DIR, opts.sessionID)
  await Filesystem.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${opts.callID}.txt`)
  await Filesystem.write(file, opts.content)
  return file
}
```

### Tool Renderer Changes
**File:** `packages/cli/src/tui/routes/session/tools.tsx`

#### `RunCommand` component (line ~377)
After computing `output` (line 384), add threshold check:

```tsx
const config = useTuiConfig()
const threshold = config.output_file_threshold ?? 5000
const [savedPath, setSavedPath] = useState<string | null>(null)

useEffect(() => {
  if (output.length > threshold && !savedPath) {
    writeOutputFile({
      sessionID: ctx.sessionID,
      callID: props.part.callID,
      content: output,
    }).then(setSavedPath)
  }
}, [output, threshold, savedPath])
```

When `savedPath` is set, render:
```tsx
<Text color={theme.textMuted as Color}>
  Output saved to: {savedPath} ({output.length.toLocaleString()} chars)
</Text>
```

Apply identical logic to:
- `CommandStatus` component (line ~774)
- `GenericTool` component (line ~185)

#### Shared hook extraction
Extract the threshold + write logic into a reusable hook:

**File [NEW]:** `packages/cli/src/tui/hooks/use-output-file.ts`
```ts
export function useOutputFile(opts: {
  output: string
  sessionID: string
  callID: string
  threshold?: number
}): { savedPath: string | null } {
  const config = useTuiConfig()
  const limit = opts.threshold ?? config.output_file_threshold ?? 5000
  const [savedPath, setSavedPath] = useState<string | null>(null)

  useEffect(() => {
    if (opts.output.length > limit && !savedPath) {
      writeOutputFile({
        sessionID: opts.sessionID,
        callID: opts.callID,
        content: opts.output,
      }).then(setSavedPath)
    }
  }, [opts.output, limit, savedPath])

  return { savedPath }
}
```

### Rendering Spec
- **Compact mode**: `$ Ran <cmd> (output: <path>)` — single inline line
- **Transcript mode**: First 50 lines of output + `\n── Full output: <path>` as muted text
- Path display: use `~` for home dir prefix, show relative path where possible

---

## 7.2 — Subagent Hint Suppression

### Status: **Already Resolved**

The `ctrl+o` hint lives exclusively in `status-line.tsx` as a global segment. It is never duplicated inside subagent tool rendering (`Task` component in `tools.tsx`). No code changes needed.

**Verification:** Confirm `ctrl+o` text only appears in `status-line.tsx` (grep for `ctrl+o` in CLI package).

---

## 7.10 — MCP Tool Compact Opt-In

### Goal
Allow MCP servers to declare tools as compact-eligible via tool metadata, extending the static allowlist at runtime.

### Compact Allowlist Changes
**File:** `packages/cli/src/tui/constants/compact-allowlist.ts`

Replace static-only set with dual-set architecture:

```ts
const STATIC_ALLOWLIST: ReadonlySet<string> = new Set([
  "read", "grep", "glob", "list", "codesearch",
  "websearch", "webfetch", "write", "edit", "apply_patch",
])

const dynamicAllowlist = new Set<string>()

export function registerCompactTool(toolName: string): void {
  dynamicAllowlist.add(toolName)
}

export function unregisterCompactTool(toolName: string): void {
  dynamicAllowlist.delete(toolName)
}

export function clearDynamicCompactTools(): void {
  dynamicAllowlist.clear()
}

export function isCompactEligible(toolName: string): boolean {
  return STATIC_ALLOWLIST.has(toolName) || dynamicAllowlist.has(toolName)
}
```

### MCP Metadata Integration
**File:** `packages/cli/src/tui/context/sync.tsx` (or wherever MCP tool list is synced from SSE)

When MCP tools are received from the server, scan for compact metadata:

```ts
// After receiving mcp tool list from server
for (const tool of mcpTools) {
  // MCP tool definitions include an `annotations` field per spec
  if (tool.annotations?.compactEligible === true) {
    registerCompactTool(tool.name)
  }
}
```

**Note:** The MCP protocol's tool `annotations` field (part of the 2025-03-26 spec) supports arbitrary key-value metadata. We read `compactEligible: true` from there — no core-side schema changes needed.

### MCP Server Disconnect Cleanup
When an MCP server disconnects, unregister its tools:
```ts
// On MCP disconnect event
for (const tool of disconnectedServer.tools) {
  unregisterCompactTool(tool.name)
}
```

---

## Files Changed Summary

| File | Action | Feature |
|---|---|---|
| `cli/config/tui-schema.ts` | MODIFY | 7.1 — add `output_file_threshold` |
| `tui/util/output-file.ts` | NEW | 7.1 — file writer utility |
| `tui/hooks/use-output-file.ts` | NEW | 7.1 — shared output file hook |
| `tui/routes/session/tools.tsx` | MODIFY | 7.1 — threshold rendering in RunCommand, CommandStatus, GenericTool |
| `tui/constants/compact-allowlist.ts` | MODIFY | 7.10 — dynamic allowlist |
| `tui/context/sync.tsx` | MODIFY | 7.10 — MCP compact registration |

## Verification
1. `bun typecheck` in `packages/cli`
2. `bun lint:fix` in `packages/cli`
3. Manual test: run a tool that produces >5000 chars, verify file is written to `$TMPDIR/liteai-output/`
4. Manual test: connect MCP server with `annotations.compactEligible: true`, verify compact rendering
