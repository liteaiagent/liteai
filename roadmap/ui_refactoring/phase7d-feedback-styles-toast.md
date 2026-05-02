# Phase 7D — Feedback, Output Styles, Toast Positioning

> Feedback System (7.8), Output Style Picker (7.9), Toast Positioning (7.7)

---

## Prerequisites
- Phase 6B complete (dialog infra, toast context)
- Existing: `toast.tsx`, `tui-schema.ts`, dialog infrastructure

## Remote-Mode Constraint
- **Output styles**: Loading custom style files from `.liteai/styles/` must go through core API (server reads from disk). The active style selection is stored in config (via existing `Config.update()`).
- **Feedback**: Feedback file export is a **user-local action** — the CLI writes to `~/.liteai/feedback/`. This is acceptable because feedback is a client-side artifact, not server state. The transcript data comes from the SDK.
- **Toast positioning**: Pure CLI-side layout change, no core involvement.

---

## 7.7 — Toast Positioning

### Goal
Render toasts at the absolute bottom of the terminal viewport.

### Layout Change
**File [MODIFY]:** `packages/cli/src/tui/routes/session/session-layout.tsx` (or wherever toasts are rendered)

Move toast rendering to a `position="absolute"` Box at the bottom:

```tsx
// At the end of the root layout, after all other children:
<Box
  position="absolute"
  bottom={0}
  width="100%"
  flexDirection="column"
  alignItems="flex-end"
>
  {toasts.map((toast) => (
    <ToastItem key={toast.id} toast={toast} />
  ))}
</Box>
```

### Toast Item Component
**File [NEW]:** `packages/cli/src/tui/components/toast-item.tsx`

Individual toast with themed styling:

```tsx
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useTheme } from "../context/theme"
import type { ToastItem as ToastItemType } from "../context/toast"

const VARIANT_ICONS: Record<string, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
}

export function ToastItem({ toast }: { toast: ToastItemType }) {
  const { theme } = useTheme()

  const colorMap: Record<string, string> = {
    info: theme.info,
    success: theme.success,
    warning: theme.warning,
    error: theme.error,
  }

  const color = colorMap[toast.variant] ?? theme.text

  return (
    <Box paddingX={1} marginBottom={0}>
      <Text color={color as Color}>
        {VARIANT_ICONS[toast.variant] ?? "·"} {toast.title ? `${toast.title}: ` : ""}{toast.message}
      </Text>
    </Box>
  )
}
```

### Verify Ink Absolute Positioning
Confirm `@liteai/ink` supports `position="absolute"` + `bottom` props. If not, use an alternative: render toasts as the last child in a full-height flex container, pushed to the bottom via `flexGrow={1}` spacer.

---

## 7.8 — Feedback/Survey System

### Goal
Per-message thumbs up/down ratings + `/feedback` command for detailed bug reports with transcript redaction.

### Core: Output Styles API (shared infrastructure)
The feedback system needs transcript data from the SDK. This is already available via `GET /session/:id/message`. No new core endpoints for feedback itself.

### Redaction Utility
**File [NEW]:** `packages/cli/src/tui/util/redact.ts`

Port of sensitive info redaction patterns:

```ts
const PATTERNS: [RegExp, string][] = [
  // API keys
  [/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]"],
  [/key-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]"],

  // AWS credentials
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]"],
  [/[a-zA-Z0-9/+]{40}/g, (match) => {
    // Only redact if preceded by 'secret' context
    return match
  }],

  // Bearer tokens
  [/Bearer\s+[a-zA-Z0-9._-]{20,}/g, "Bearer [REDACTED_TOKEN]"],

  // Generic secrets
  [/(password|secret|token|apikey|api_key)\s*[:=]\s*["']?[^\s"']{8,}/gi,
    "$1=[REDACTED]"],

  // File paths with user home directory
  [/\/Users\/[a-zA-Z0-9._-]+/g, "/Users/[REDACTED]"],
  [/\/home\/[a-zA-Z0-9._-]+/g, "/home/[REDACTED]"],
  [/C:\\Users\\[a-zA-Z0-9._-]+/g, "C:\\Users\\[REDACTED]"],
]

export function redactSensitiveInfo(text: string): string {
  let result = text
  for (const [pattern, replacement] of PATTERNS) {
    if (typeof replacement === "string") {
      result = result.replace(pattern, replacement)
    }
  }
  return result
}
```

### Feedback Dialog
**File [NEW]:** `packages/cli/src/tui/components/dialog-feedback.tsx`

Multi-step feedback dialog:

```tsx
type FeedbackStep = "input" | "preview" | "saving" | "done"

export function DialogFeedback() {
  const [step, setStep] = useState<FeedbackStep>("input")
  const [description, setDescription] = useState("")
  const [includeTranscript, setIncludeTranscript] = useState(true)
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const sync = useSync()

  // Step 1: Text input for description
  // Step 2: Preview showing what will be saved (redacted)
  // Step 3: Save to ~/.liteai/feedback/<timestamp>.json
  // Step 4: Confirmation + optional GitHub issue URL

  async function submit() {
    setStep("saving")

    const sessionID = /* current session from context */
    const messages = await sdk.client.project.session.messages({
      param: { sessionID },
    })

    const transcript = messages.map(m => ({
      role: m.info.role,
      // Redact message text parts
      content: redactSensitiveInfo(JSON.stringify(m.parts)),
    }))

    const feedback = {
      timestamp: Date.now(),
      description,
      sessionID,
      transcript: includeTranscript ? transcript : undefined,
      environment: {
        version: sync.version,
        os: process.platform,
        arch: process.arch,
      },
    }

    // Write to local feedback directory
    const dir = path.join(Global.Path.state, "feedback")
    await Filesystem.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${Date.now()}.json`)
    await Filesystem.writeJson(file, feedback)

    setStep("done")
    toast.show({ variant: "success", message: `Feedback saved to ${file}` })
  }
}
```

### Per-Message Rating (lightweight inline)
**File [MODIFY]:** `packages/cli/src/tui/routes/session/assistant.tsx` (or wherever assistant messages render)

After each completed assistant message, show a subtle rating hint:

```tsx
// Only show for the most recent assistant message, in idle state
{isLastMessage && !isStreaming && (
  <Box>
    <Text color={theme.textMuted as Color}>
      Rate: 1 👍 · 2 👎
    </Text>
  </Box>
)}
```

Rating is stored locally (not in core) via a simple JSON file at `~/.liteai/state/ratings.json`:
```ts
{ [sessionID_messageID]: "good" | "bad" }
```

### Slash Command
Register `/feedback` → opens `DialogFeedback`.

---

## 7.9 — Output Style Picker

### Goal
Named output styles (response personalities) loadable from `.liteai/styles/` and selectable via settings.

### Core: Output Style Loader
**File [NEW]:** `packages/core/src/style/style.ts`

```ts
import path from "node:path"
import { Fs as Filesystem } from "@liteai/util/fs"
import matter from "gray-matter"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Brand } from "../brand"
import { Bundled } from "../bundled"

export namespace OutputStyle {
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    prompt: z.string(),
    source: z.enum(["built-in", "custom"]),
    keepCodingInstructions: z.boolean().optional(),
  })
  export type Info = z.infer<typeof Info>

  const BUILTIN_STYLES: Info[] = [
    {
      name: "default",
      description: "Standard response style",
      prompt: "",
      source: "built-in",
    },
    {
      name: "explanatory",
      description: "Explains implementation choices with educational insights",
      prompt: `You should provide educational insights about the codebase.
Before and after writing code, provide brief educational explanations.
Focus on interesting insights specific to the codebase rather than general concepts.`,
      source: "built-in",
      keepCodingInstructions: true,
    },
  ]

  export async function list(): Promise<Info[]> {
    const styles = [...BUILTIN_STYLES]

    // Load custom styles from .liteai/styles/
    const stylesDir = path.join(Instance.directory, Brand.dir, "styles")
    if (await Filesystem.exists(stylesDir)) {
      const files = await Filesystem.list(stylesDir)
      for (const file of files) {
        if (!file.endsWith(".md")) continue
        const raw = await Filesystem.read(path.join(stylesDir, file))
        const { data, content } = matter(raw)
        styles.push({
          name: data.name ?? file.replace(".md", ""),
          description: data.description ?? "",
          prompt: content.trim(),
          source: "custom",
          keepCodingInstructions: data.keepCodingInstructions,
        })
      }
    }

    return styles
  }

  export async function get(name: string): Promise<Info | undefined> {
    const styles = await list()
    return styles.find(s => s.name === name)
  }

  /** Get the currently active style based on config */
  export async function active(): Promise<Info | undefined> {
    const cfg = await Config.get()
    const name = (cfg as Record<string, unknown>).outputStyle as string | undefined
    if (!name || name === "default") return undefined
    return get(name)
  }
}
```

### Core: Style Routes
**File [NEW]:** `packages/core/src/server/routes/style.ts`

```ts
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { OutputStyle } from "../../style/style"
import { lazy } from "../../util/lazy"

export const StyleRoutes = lazy(() =>
  new Hono()
    .get("/", async (c) => {
      const styles = await OutputStyle.list()
      return c.json(styles)
    })
    .get("/active", async (c) => {
      const style = await OutputStyle.active()
      return c.json(style ?? null)
    }),
)
```

Mount in main router: `.route("/style", StyleRoutes())`

### Core: Style Integration with Agent System Prompt
**File [MODIFY]:** `packages/core/src/agent/agent.ts` (or the system prompt builder)

When assembling the system prompt for a session, check for an active output style and append its prompt:

```ts
const activeStyle = await OutputStyle.active()
if (activeStyle && activeStyle.prompt) {
  systemParts.push(`\n# Output Style: ${activeStyle.name}\n${activeStyle.prompt}`)
}
```

### Config Schema Extension
**File [MODIFY]:** `packages/core/src/config/schema.ts` (or equivalent)

Add `outputStyle` to the config schema:
```ts
outputStyle: z.string().optional().describe("Active output style name")
```

### CLI: Output Style Dialog
**File [NEW]:** `packages/cli/src/tui/components/dialog-output-style.tsx`

```tsx
import { useMemo, useState, useEffect } from "react"
import { useSDK } from "../context/sdk"
import { useDialog } from "../context/dialog"
import { useToast } from "../context/toast"
import { DialogSelect } from "../ui/dialog-select"

export function DialogOutputStyle() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const [styles, setStyles] = useState<Array<{ name: string; description: string }>>([])

  useEffect(() => {
    sdk.client.project.style.list().then(setStyles)
  }, [sdk])

  const options = useMemo(
    () => styles.map(s => ({
      value: s.name,
      title: s.name,
      description: s.description,
    })),
    [styles]
  )

  return (
    <DialogSelect
      title="Select output style"
      options={options}
      onSelect={async (option) => {
        await sdk.client.project.config.update({
          json: { outputStyle: option.value },
        })
        toast.show({
          variant: "success",
          message: `Output style set to: ${option.value}`,
        })
        dialog.clear()
      }}
    />
  )
}
```

### Slash Command + Settings Hub Entry
- Register `/style` → opens `DialogOutputStyle`
- Add entry in settings dialog (if one exists)

---

## Files Changed Summary

| File | Action | Package | Feature |
|---|---|---|---|
| `cli/tui/routes/session/session-layout.tsx` | MODIFY | cli | 7.7 — absolute toast positioning |
| `cli/tui/components/toast-item.tsx` | NEW | cli | 7.7 — styled toast component |
| `cli/tui/util/redact.ts` | NEW | cli | 7.8 — sensitive info redaction |
| `cli/tui/components/dialog-feedback.tsx` | NEW | cli | 7.8 — feedback dialog |
| `cli/tui/routes/session/assistant.tsx` | MODIFY | cli | 7.8 — per-message rating hint |
| `core/src/style/style.ts` | NEW | core | 7.9 — output style loader |
| `core/src/server/routes/style.ts` | NEW | core | 7.9 — style REST endpoints |
| `core/src/config/schema.ts` | MODIFY | core | 7.9 — add `outputStyle` field |
| `core/src/agent/agent.ts` or system prompt builder | MODIFY | core | 7.9 — inject active style prompt |
| `cli/tui/components/dialog-output-style.tsx` | NEW | cli | 7.9 — style picker dialog |
| Slash command registration | MODIFY | cli | 7.8, 7.9 — `/feedback`, `/style` |

## Verification
1. `bun typecheck` across core, sdk, cli
2. `bun lint:fix` across all
3. Manual: verify toasts render at terminal bottom
4. Manual: `/feedback` → enter description → verify JSON file at `~/.liteai/state/feedback/`
5. Manual: create `.liteai/styles/concise.md` with frontmatter → `/style` → select → verify prompt injection
6. `bun test test/config` — verify outputStyle persistence
