# Phase 7C — Advanced Stats & Session Tagging

> Advanced Stats (7.4), Session Tagging/Renaming (7.6)

---

## Prerequisites
- Phase 6B complete (dialog infrastructure)
- Existing: `dialog-stats.tsx` (199 lines), `dialog-session-list.tsx`, Session routes

## Remote-Mode Constraint
- **Stats aggregation** must be computed CLI-side from data retrieved via SDK. The session list API (`GET /session`) already returns `Session.Info` with timestamps and token usage. No new core endpoints needed for basic stats.
- **Session tagging** requires a DB schema change in core (new `tags` column) + route change to accept tags in `PATCH /session/:id`.

---

## 7.4 — Advanced Stats

### Goal
Add a "Global" tab to the stats dialog with activity heatmap, streaks, date ranges, and fun factoids.

### Data Aggregation Hook
**File [NEW]:** `packages/cli/src/tui/hooks/use-global-stats.ts`

Fetches all sessions via SDK and computes aggregate stats:

```ts
import { useMemo, useState, useEffect } from "react"
import { useSDK } from "../context/sdk"
import type { Session } from "@liteai/sdk"

export type DateRange = "7d" | "30d" | "90d" | "all"

export interface GlobalStats {
  loading: boolean
  totalSessions: number
  totalTokens: number
  totalCost: number
  dailyActivity: Map<string, number>  // "YYYY-MM-DD" → session count
  longestStreak: number
  currentStreak: number
  peakDay: { date: string; count: number } | null
  dateRange: DateRange
}

export function useGlobalStats(range: DateRange): GlobalStats {
  const sdk = useSDK()
  const [sessions, setSessions] = useState<Session.Info[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const start = rangeToTimestamp(range)
    sdk.client.project.session.list({
      query: { start, roots: true, limit: 1000 },
    })
      .then(setSessions)
      .finally(() => setLoading(false))
  }, [sdk, range])

  return useMemo(() => {
    if (loading) return { loading: true, /* ...defaults */ }

    const dailyActivity = new Map<string, number>()
    let totalTokens = 0
    let totalCost = 0

    for (const s of sessions) {
      const day = new Date(s.time.created).toISOString().split("T")[0]
      dailyActivity.set(day, (dailyActivity.get(day) ?? 0) + 1)
      // Token/cost from session summary if available
    }

    const { longestStreak, currentStreak } = computeStreaks(dailyActivity)
    const peakDay = findPeakDay(dailyActivity)

    return {
      loading: false,
      totalSessions: sessions.length,
      totalTokens,
      totalCost,
      dailyActivity,
      longestStreak,
      currentStreak,
      peakDay,
      dateRange: range,
    }
  }, [sessions, loading, range])
}

function rangeToTimestamp(range: DateRange): number | undefined {
  if (range === "all") return undefined
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  return Date.now() - days * 24 * 60 * 60 * 1000
}

function computeStreaks(daily: Map<string, number>) {
  const days = [...daily.keys()].sort()
  let longestStreak = 0
  let currentStreak = 0
  let streak = 0
  const today = new Date().toISOString().split("T")[0]

  for (let i = 0; i < days.length; i++) {
    if (i === 0 || isConsecutive(days[i - 1], days[i])) {
      streak++
    } else {
      streak = 1
    }
    longestStreak = Math.max(longestStreak, streak)
  }

  // Current streak: count backwards from today
  const sortedDesc = [...days].reverse()
  currentStreak = 0
  let check = today
  for (const day of sortedDesc) {
    if (day === check || isConsecutive(day, check)) {
      currentStreak++
      check = day
    } else break
  }

  return { longestStreak, currentStreak }
}
```

### Heatmap Renderer
**File [NEW]:** `packages/cli/src/tui/components/heatmap.tsx`

Terminal-width-aware activity heatmap using Unicode block characters:

```tsx
import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useMemo } from "react"
import { useTheme } from "../context/theme"

const BLOCKS = [" ", "░", "▒", "▓", "█"]

interface HeatmapProps {
  dailyActivity: Map<string, number>
  weeks: number  // how many weeks to show
  width: number  // available terminal width
}

export function Heatmap({ dailyActivity, weeks, width }: HeatmapProps) {
  const { theme } = useTheme()

  const grid = useMemo(() => {
    // Build 7-row × N-column grid (Mon-Sun × weeks)
    // Each cell maps to a day, intensity based on session count
    const maxCount = Math.max(1, ...dailyActivity.values())
    const cells: { day: string; level: number }[][] = []

    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - weeks * 7)

    for (let w = 0; w < weeks && w * 2 + 10 < width; w++) {
      const col: typeof cells[0] = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(start)
        date.setDate(date.getDate() + w * 7 + d)
        const key = date.toISOString().split("T")[0]
        const count = dailyActivity.get(key) ?? 0
        const level = Math.min(4, Math.ceil((count / maxCount) * 4))
        col.push({ day: key, level })
      }
      cells.push(col)
    }
    return cells
  }, [dailyActivity, weeks, width])

  return (
    <Box flexDirection="column">
      {[0, 1, 2, 3, 4, 5, 6].map((row) => (
        <Box key={row} flexDirection="row">
          {grid.map((col, w) => {
            const cell = col[row]
            if (!cell) return null
            const color = cell.level === 0
              ? theme.textMuted
              : cell.level <= 2
                ? theme.info
                : theme.success
            return (
              <Text key={w} color={color as Color}>
                {BLOCKS[cell.level]}{BLOCKS[cell.level]}
              </Text>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
```

### Stats Dialog Enhancement
**File [MODIFY]:** `packages/cli/src/tui/components/dialog-stats.tsx`

Add tab switching (Session / Global):

```tsx
const [tab, setTab] = useState<"session" | "global">("session")
const [dateRange, setDateRange] = useState<DateRange>("30d")
const globalStats = useGlobalStats(dateRange)

// Keybinding: Tab key cycles session ↔ global
// Keybinding: 'r' cycles date range in global tab

// Global tab renders:
// 1. Summary row: totalSessions, longestStreak, currentStreak
// 2. Heatmap component
// 3. Peak day callout
// 4. Fun factoid (token comparisons)
```

**Factoid generator:**
```ts
const FACTOIDS = [
  { threshold: 730_000, text: "That's roughly War and Peace in tokens!" },
  { threshold: 100_000, text: "That's a short novel worth of tokens." },
  { threshold: 1_000_000, text: "You've crossed the million-token mark!" },
]
```

---

## 7.6 — Session Tagging/Renaming

### Goal
Tag sessions with user-defined labels, filter session list by tags.

### Core DB Schema Change
**File [MODIFY]:** `packages/core/src/session/session.sql.ts`

Add `tags` column:
```ts
tags: text("tags")  // comma-separated string, nullable
```

### Core Session Functions
**File [MODIFY]:** `packages/core/src/session/index.ts`

1. Add `tags` to `Session.Info` schema:
```ts
tags: z.array(z.string()).optional(),
```

2. Add to `fromRow()`:
```ts
tags: row.tags ? row.tags.split(",").filter(Boolean) : undefined,
```

3. Add to `toRow()`:
```ts
tags: info.tags?.join(",") ?? null,
```

4. Add `setTags` function:
```ts
export const setTags = fn(
  z.object({
    sessionID: SessionID.zod,
    tags: z.array(z.string()),
  }),
  async (input) => {
    return Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ tags: input.tags.join(","), time_updated: Date.now() })
        .where(eq(SessionTable.id, input.sessionID))
        .returning()
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found` })
      const info = fromRow(row)
      Database.effect(() => Bus.publish(Event.Updated, { info }))
      return info
    })
  },
)
```

5. Add `listTags` function for autocomplete:
```ts
export function listTags(): string[] {
  const rows = Database.use((db) =>
    db.select({ tags: SessionTable.tags })
      .from(SessionTable)
      .where(isNotNull(SessionTable.tags))
      .all()
  )
  const tagSet = new Set<string>()
  for (const row of rows) {
    if (row.tags) {
      for (const t of row.tags.split(",")) {
        if (t.trim()) tagSet.add(t.trim())
      }
    }
  }
  return [...tagSet].sort()
}
```

### Core Route Changes
**File [MODIFY]:** `packages/core/src/server/routes/session.ts`

1. Add `tags` to the PATCH validator (line ~349):
```ts
tags: z.array(z.string()).optional(),
```

2. Handle in the PATCH handler:
```ts
if (updates.tags !== undefined) {
  session = await Session.setTags({ sessionID, tags: updates.tags })
}
```

3. Add tag filter to GET `/` query params:
```ts
tag: z.string().optional().meta({ description: "Filter sessions by tag" }),
```

4. In list handler, filter by tag:
```ts
if (query.tag) {
  conditions.push(like(SessionTable.tags, `%${query.tag}%`))
}
```

5. Add new endpoint `GET /session/tags`:
```ts
.get("/tags", async (c) => {
  const tags = Session.listTags()
  return c.json(tags)
})
```

### SDK Extension
Add tag methods to SDK client:
```ts
session: {
  // existing methods...
  setTags: (params) => PATCH(`/session/${params.sessionID}`, { tags: params.tags }),
  listTags: () => GET("/session/tags"),
}
```

### CLI Session List Changes
**File [MODIFY]:** `packages/cli/src/tui/components/dialog-session-list.tsx`

1. Add tag filter bar above the session list:
```tsx
const [activeTag, setActiveTag] = useState<string | null>(null)
const [tags, setTags] = useState<string[]>([])

useEffect(() => {
  sdk.client.project.session.listTags().then(setTags)
}, [sdk])

// Render: "All" + tag chips above the list
// Tab key cycles through tags
// Active tag filters the displayed sessions
```

2. Add `ctrl+t` keybinding for tagging selected session:
```tsx
// Opens a mini text input with autocomplete from existing tags
// On submit: sdk.client.project.session.setTags({ sessionID, tags: [...existing, newTag] })
```

3. Show tags in session list items:
```tsx
// After title: #tag1 #tag2 in muted color
description: session.tags?.length
  ? `${session.tags.map(t => `#${t}`).join(" ")}`
  : undefined
```

### Tag Input Component
**File [NEW]:** `packages/cli/src/tui/components/tag-input.tsx`

Mini autocomplete input for tag entry:
```tsx
export function TagInput(props: {
  suggestions: string[]
  onSubmit: (tag: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState("")
  const filtered = useMemo(
    () => props.suggestions.filter(s => s.includes(value)),
    [props.suggestions, value]
  )
  // TextInput with dropdown suggestions
}
```

---

## DB Migration
**File [NEW]:** `packages/core/src/storage/migrations/add-session-tags.ts`

```sql
ALTER TABLE session ADD COLUMN tags TEXT;
```

Integrate into the existing migration runner (check `packages/core/src/storage/` for migration pattern).

---

## Files Changed Summary

| File | Action | Package | Feature |
|---|---|---|---|
| `core/src/session/session.sql.ts` | MODIFY | core | 7.6 — add `tags` column |
| `core/src/session/index.ts` | MODIFY | core | 7.6 — `setTags`, `listTags`, schema update |
| `core/src/server/routes/session.ts` | MODIFY | core | 7.6 — tag filter, tag endpoints |
| `core/storage/migrations/` | NEW | core | 7.6 — DB migration |
| `sdk/src/client.ts` | MODIFY | sdk | 7.6 — tag SDK methods |
| `cli/tui/hooks/use-global-stats.ts` | NEW | cli | 7.4 — stats aggregation |
| `cli/tui/components/heatmap.tsx` | NEW | cli | 7.4 — activity heatmap |
| `cli/tui/components/dialog-stats.tsx` | MODIFY | cli | 7.4 — tab system + global stats |
| `cli/tui/components/dialog-session-list.tsx` | MODIFY | cli | 7.6 — tag filter + ctrl+t |
| `cli/tui/components/tag-input.tsx` | NEW | cli | 7.6 — tag autocomplete |

## Verification
1. `bun typecheck` across core, sdk, cli
2. `bun lint:fix` across all
3. `bun test test/session` — verify tag persistence
4. Manual: verify heatmap renders correctly at various terminal widths
5. Manual: tag a session → filter session list by tag → verify filtering
6. Manual: cycle date ranges in stats → verify data updates
