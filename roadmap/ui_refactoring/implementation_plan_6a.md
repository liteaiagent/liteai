# Implementation Plan — Phase 6A: Search & Memory

> **Scope**: Transcript search, global workspace search, cross-session search, memory management UI
> **Packages touched**: `packages/core` (routes, ripgrep), `packages/sdk` (client types), `packages/cli` (TUI components)
> **Prerequisite**: Phase 5 complete (compact mode, diff dialogs, rewind, session browser all implemented)
> **Companion doc**: [analysis_and_questions.md](./analysis_and_questions.md) — all design decisions resolved

---

## 6.0 — Transcript Search (In-Memory)

Search through the current session's rendered messages. Entirely client-side — no backend changes.

### Design

- Triggered by `ctrl+f` keybinding (Chat context) or `/search` slash command
- Opens a search bar at the top of the message list (not a dialog — keeps transcript visible)
- Searches text parts of all messages in `sync.message[sessionID]` and `sync.part[msgID]`
- Highlights matches in the virtual message list via Ink's `searchHighlight` system
- Navigation: `ctrl+n` next match, `ctrl+p` previous match, `Esc` close

### Files

#### [NEW] `packages/cli/src/tui/components/transcript-search.tsx`

```tsx
// Props
type TranscriptSearchProps = {
  sessionID: string
  onClose: () => void
}

// State
// - query: string (debounced 100ms)
// - matches: Array<{ messageID: string, partID: string, offset: number, length: number }>
// - currentIndex: number

// Logic:
// 1. Iterate sync.message[sessionID] → for each message, iterate sync.part[msgID]
// 2. For text parts: search part.state.text for query (case-insensitive)
// 3. For tool parts: search stringified input/output for query
// 4. Build flat match array with messageID + partID + offset
// 5. On currentIndex change, scroll VirtualMessageList to the matching message

// Rendering:
// - Thin bar at top: 🔎 input | "3/17 matches" | ctrl+n/p/Esc hints
// - Uses ThemedBox with borderStyle="round" borderColor="info"
```

**Component API**:
```typescript
export function TranscriptSearch({ sessionID, onClose }: TranscriptSearchProps): React.ReactNode
export type TranscriptMatch = { messageID: string; partID: string; offset: number; length: number }
```

#### [MODIFY] `packages/cli/src/tui/components/session-layout.tsx`

Add a `searchActive: boolean` state. When true, render `<TranscriptSearch>` above the `<VirtualMessageList>`. Pass the `scrollToMessage(messageID)` callback from the virtual list.

```diff
+ import { TranscriptSearch } from "./transcript-search"
+ const [searchActive, setSearchActive] = useState(false)

  // In JSX, above VirtualMessageList:
+ {searchActive && (
+   <TranscriptSearch
+     sessionID={session.sessionID}
+     onClose={() => setSearchActive(false)}
+   />
+ )}
```

#### [MODIFY] `packages/cli/src/tui/keybindings/default-bindings.ts`

Add to Chat context:
```diff
  "ctrl+s": "chat:stash",
+ "ctrl+f": "chat:transcriptSearch",
```

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

1. Add `search` to `TUI_COMMANDS`:
```typescript
{ name: "search", description: "Search transcript messages", template: "", hints: [] },
```

2. Add to `tuiInterceptors`:
```typescript
search: () => { /* set searchActive via a shared ref or context */ },
```

> **Note**: The `searchActive` state lives in `session-layout.tsx`. Use a lightweight context or a ref passed down to the prompt. Evaluate: simplest approach is a `useTranscriptSearch` hook in a new context file that both session-layout and prompt-input consume. Alternatively, use `dialog.push()` with a non-modal search component.

#### [MODIFY] `packages/cli/src/tui/components/virtual-message-list.tsx`

Expose a `scrollToMessage(messageID: string)` imperative method via `useImperativeHandle`. The TranscriptSearch component calls this when the user navigates between matches.

---

## 6.1 — Global Workspace Search (Backend Ripgrep)

Search file contents across the project. Backend provides the route; CLI renders results with preview.

### Design

- Triggered by `ctrl+shift+f` keybinding or `/find` slash command
- Opens a `FuzzyPicker`-based dialog with ripgrep results
- Backend: `GET /file/find?pattern=<query>` — **already exists** in [file.ts](file:///d:/liteai/packages/core/src/server/routes/file.ts#L13-L43)
- Current limit is 10. Increase to configurable (default 50, max 500)
- Client debounces input (150ms), calls SDK, renders results
- Preview pane: on focus, fetch file content via `GET /file/content?path=<path>` (also already exists)
- Tab inserts as `@file` mention, Enter opens in `$EDITOR`

### Files

#### [MODIFY] `packages/core/src/server/routes/file.ts`

Enhance the `/find` route to accept `limit` and `maxPerFile` query params:

```diff
  validator(
    "query",
    z.object({
      pattern: z.string(),
+     limit: z.coerce.number().int().min(1).max(500).optional(),
+     maxPerFile: z.coerce.number().int().min(1).max(50).optional(),
    }),
  ),
  async (c) => {
    const pattern = c.req.valid("query").pattern
+   const limit = c.req.valid("query").limit ?? 50
+   const maxPerFile = c.req.valid("query").maxPerFile ?? 10
    const result = await Ripgrep.search({
      cwd: Instance.directory,
      pattern,
-     limit: 10,
+     limit,
+     maxPerFile,
    })
    return c.json(result)
  },
```

Also verify `Ripgrep.search()` supports `maxPerFile`. If not, pass `-m <maxPerFile>` flag to the ripgrep spawn call.

#### [MODIFY] `packages/core/src/file/ripgrep.ts` (if needed)

Add `maxPerFile` to the search options interface and pass as `-m` flag to the `rg` child process.

#### [NEW] `packages/cli/src/tui/components/dialog-search.tsx`

```tsx
// Uses FuzzyPicker with:
// - items: fetched from SDK /file/find route
// - renderItem: shows filepath + line number + highlighted match
// - renderPreview: fetches file content, shows ~10 lines around match
// - onSelect: opens file in $EDITOR at line number (reuse existing editor.ts)
// - onTab: inserts @filepath into prompt input

type SearchResult = {
  file: string
  line: number
  content: string
  matchStart: number
  matchEnd: number
}

export function DialogSearch(): React.ReactNode {
  const sdk = useSDK()
  const dialog = useDialog()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const debounced = useDebouncedValue(query, 150)

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return }
    const abort = new AbortController()
    sdk.fetch(`${sdk.url}/file/find?pattern=${encodeURIComponent(debounced)}&limit=50`, { signal: abort.signal })
      .then(r => r.json())
      .then(setResults)
      .catch(() => {})
    return () => abort.abort()
  }, [debounced, sdk])

  return (
    <FuzzyPicker
      title="Search Workspace"
      items={results}
      getKey={r => `${r.file}:${r.line}`}
      renderItem={(r, focused) => (
        <Box>
          <Text color={focused ? "info" : undefined}>{normalizePath(r.file)}:{r.line}</Text>
          <Text dim> {r.content.trim()}</Text>
        </Box>
      )}
      renderPreview={r => <FilePreview path={r.file} line={r.line} />}
      previewPosition="right"
      onQueryChange={setQuery}
      onSelect={r => openFileInEditor(r.file, r.line)}
      onTab={{ action: "insert @mention", handler: r => insertAtMention(r.file) }}
      onCancel={() => dialog.pop()}
      emptyMessage={q => q ? "No matches found" : "Type to search…"}
      matchLabel={results.length > 0 ? `${results.length} matches` : undefined}
    />
  )
}
```

#### [NEW] `packages/cli/src/tui/hooks/use-debounced-value.ts`

Simple debounce hook:
```typescript
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
```

#### [MODIFY] `packages/cli/src/tui/keybindings/default-bindings.ts`

```diff
  "ctrl+s": "chat:stash",
  "ctrl+f": "chat:transcriptSearch",
+ "ctrl+shift+f": "chat:workspaceSearch",
```

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

1. Add to `TUI_COMMANDS`:
```typescript
{ name: "find", description: "Search file contents across the workspace", template: "", hints: [] },
```

2. Add to `tuiInterceptors`:
```typescript
find: () => dialog.push(() => <DialogSearch />),
```

---

## 6.2 — Cross-Session Search (FTS5 SQLite)

Search message content across all sessions. Requires a new backend FTS5 virtual table + route.

### Design

- Triggered by `/sessions search <query>` or from the session browser dialog
- Backend: New `GET /session/search?q=<query>` route using FTS5
- Returns session ID + message snippet + timestamp
- Client renders as a session picker with message preview

### Files

#### [NEW] `packages/core/src/storage/fts.ts`

FTS5 virtual table for message content search:

```typescript
import { Database } from "./db"

export namespace FTS {
  /**
   * Initialize FTS5 virtual table if it doesn't exist.
   * Called once during server startup.
   */
  export function initialize(): void {
    const db = Database.get()
    // Create FTS5 virtual table mirroring message text content
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        sessionID UNINDEXED,
        messageID UNINDEXED,
        role UNINDEXED,
        content,
        tokenize='porter unicode61'
      )
    `)
  }

  /**
   * Index a message's text content for FTS.
   * Called after message persistence.
   */
  export function index(params: {
    sessionID: string
    messageID: string
    role: string
    content: string
  }): void {
    const db = Database.get()
    // Upsert: delete existing entry if present, then insert
    db.exec(`DELETE FROM message_fts WHERE messageID = ?`, [params.messageID])
    db.exec(
      `INSERT INTO message_fts (sessionID, messageID, role, content) VALUES (?, ?, ?, ?)`,
      [params.sessionID, params.messageID, params.role, params.content]
    )
  }

  /**
   * Search messages across all sessions.
   */
  export function search(query: string, limit = 50): Array<{
    sessionID: string
    messageID: string
    role: string
    snippet: string
    rank: number
  }> {
    const db = Database.get()
    return db.query(`
      SELECT
        sessionID,
        messageID,
        role,
        snippet(message_fts, 3, '<mark>', '</mark>', '…', 32) as snippet,
        rank
      FROM message_fts
      WHERE message_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit)
  }

  /**
   * Remove all FTS entries for a session (on session delete).
   */
  export function removeSession(sessionID: string): void {
    const db = Database.get()
    db.exec(`DELETE FROM message_fts WHERE sessionID = ?`, [sessionID])
  }
}
```

> **Integration point**: Call `FTS.index()` from the message persistence pipeline. Find where messages are written in `packages/core/src/session/engine/persister.ts` or `persistence-writer.ts` and add a call after successful message write.

#### [MODIFY] `packages/core/src/session/engine/persister.ts` (or `persistence-writer.ts`)

After a message is persisted, index its text content:

```diff
+ import { FTS } from "../../storage/fts"

  // After message write:
+ const textContent = extractTextFromParts(message.parts)
+ if (textContent) {
+   FTS.index({
+     sessionID: message.sessionID,
+     messageID: message.id,
+     role: message.info.role,
+     content: textContent,
+   })
+ }
```

Helper function to extract text:
```typescript
function extractTextFromParts(parts: Message.Part[]): string {
  return parts
    .filter(p => p.type === "text")
    .map(p => p.state.text ?? "")
    .join("\n")
}
```

#### [MODIFY] `packages/core/src/server/routes/session.ts`

Add a new search route:

```typescript
.get(
  "/search",
  describeRoute({
    summary: "Search messages across sessions",
    description: "Full-text search across all session message content using FTS5.",
    operationId: "project.session.search",
    responses: {
      200: {
        description: "Search results",
        content: {
          "application/json": {
            schema: resolver(z.array(z.object({
              sessionID: z.string(),
              messageID: z.string(),
              role: z.string(),
              snippet: z.string(),
              rank: z.number(),
            }))),
          },
        },
      },
    },
  }),
  validator("query", z.object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })),
  async (c) => {
    const { q, limit } = c.req.valid("query")
    const results = FTS.search(q, limit ?? 50)
    return c.json(results)
  },
)
```

> **IMPORTANT**: This route must be placed BEFORE the `/:sessionID` route in the chain, otherwise Hono will interpret "search" as a sessionID parameter.

#### [MODIFY] `packages/core/src/storage/db.ts` (or server startup)

Call `FTS.initialize()` during server startup to ensure the virtual table exists.

#### [MODIFY] `packages/cli/src/tui/components/dialog-session-list.tsx`

Add a search mode to the existing session browser:

```diff
+ import { useSDK } from "../../context/sdk"

  // Add a search input at the top of the session list
  // When query is entered, switch from listing sessions to showing FTS results
  // Each result shows: session title + message snippet + timestamp
  // On select: navigate to that session and scroll to the matching message
```

---

## 6.3 — Memory Management Dialog

TUI interface for browsing and managing agent memory files. Core infrastructure already exists.

### Design

- Triggered by `/memory` slash command or `ctrl+x m` keybinding
- Shows a list of memory files discovered from `.liteai/memory/` (project + user)
- Actions: View content, Edit in `$EDITOR`, Delete
- Uses existing `AgentMemory.getAgentMemoryDir()` from core

### Files

#### [NEW] `packages/cli/src/tui/components/dialog-memory.tsx`

```tsx
import { AgentMemory } from "@liteai/core/agent/memory"

type MemoryFile = {
  path: string
  scope: "user" | "project" | "local"
  agentType: string
  exists: boolean
  size?: number
}

export function DialogMemory(): React.ReactNode {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [files, setFiles] = useState<MemoryFile[]>([])

  useEffect(() => {
    // Discover memory files:
    // 1. Scan ~/.liteai/memory/ for user-scope memories
    // 2. Scan .liteai/memory/ for project-scope memories
    // 3. For each agentType dir found, check for MEMORY.md
    discoverMemoryFiles().then(setFiles)
  }, [])

  const options = useMemo(() => files.map(f => ({
    value: f.path,
    title: `${f.agentType} (${f.scope})`,
    description: f.exists ? `${f.size} bytes` : "(empty)",
    footer: <Text color={f.exists ? theme.success : theme.textMuted}>{f.exists ? "✓" : "○"}</Text>,
  })), [files, theme])

  return (
    <DialogSelect
      title="Agent Memory"
      header={<Text color={theme.textMuted}>{files.length} memory files</Text>}
      options={options}
      onSelect={async (option) => {
        dialog.push(() => <MemoryDetail path={option.value} onBack={() => dialog.pop()} />)
      }}
      footerContent={<Text color={theme.textMuted}>↑↓ navigate · Enter view · Esc cancel</Text>}
    />
  )
}

function MemoryDetail({ path, onBack }: { path: string; onBack: () => void }) {
  // Shows file content in a scrollable view
  // Actions: "Edit in $EDITOR", "Delete", "Back"
  // Edit uses existing editor integration from packages/cli/src/tui/components/prompt/editor.ts
}
```

#### [NEW] `packages/cli/src/tui/hooks/use-memory-files.ts`

```typescript
import fs from "node:fs/promises"
import path from "node:path"
import { AgentMemory } from "@liteai/core/agent/memory"
import { Instance } from "@liteai/core/project/instance"
import { Global } from "@liteai/core/global"

export type MemoryFile = {
  path: string
  scope: "user" | "project" | "local"
  agentType: string
  exists: boolean
  size?: number
}

export async function discoverMemoryFiles(): Promise<MemoryFile[]> {
  const results: MemoryFile[] = []
  const scopes = ["user", "project"] as const

  for (const scope of scopes) {
    const baseDir = scope === "user"
      ? path.join(Global.Path.home, ".liteai", "memory")
      : path.join(Instance.directory, ".liteai", "memory")

    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const memFile = path.join(baseDir, entry.name, "MEMORY.md")
        try {
          const stat = await fs.stat(memFile)
          results.push({ path: memFile, scope, agentType: entry.name, exists: true, size: stat.size })
        } catch {
          results.push({ path: memFile, scope, agentType: entry.name, exists: false })
        }
      }
    } catch {
      // Directory doesn't exist — no memories for this scope
    }
  }

  return results
}
```

#### [MODIFY] `packages/cli/src/tui/components/prompt/prompt-input.tsx`

1. Add to `TUI_COMMANDS`:
```typescript
{ name: "memory", description: "Browse and manage agent memory files", template: "", hints: [] },
```

2. Add to `tuiInterceptors`:
```typescript
memory: () => dialog.push(() => <DialogMemory />),
```

#### [MODIFY] `packages/cli/src/tui/keybindings/default-bindings.ts`

```diff
  "ctrl+x r": "chat:rename",
+ "ctrl+x m": "chat:memory",
```

---

## Verification Plan

### Automated
```bash
# Core: verify new routes compile and existing tests pass
cd packages/core && bun typecheck
cd packages/core && bun test test/session test/storage

# CLI: verify new components compile
cd packages/cli && bun typecheck

# Lint
bun lint:fix
```

### Manual
1. **Transcript Search**: Start session, generate some messages, press `ctrl+f`, type query, verify matches highlight, `ctrl+n`/`ctrl+p` navigates
2. **Workspace Search**: Press `ctrl+shift+f`, type a pattern known to exist in project files, verify results populate, preview shows context, Enter opens editor
3. **Cross-Session Search**: Have multiple sessions with known content, use `/sessions` and search, verify results span sessions
4. **Memory**: Run `/memory`, verify it discovers `.liteai/memory/` dirs, can view content, can open in `$EDITOR`
