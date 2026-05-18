/**
 * TodoTray — collapsible task tracker rendered below the messages area.
 *
 * Displays the session's todo list from the `todo` app state slice.
 * Renders as a compact sidebar-style tray showing task status indicators.
 *
 * Status display:
 * - `pending`     → ○ (empty circle)
 * - `in_progress` → ◑ (half circle)
 * - `completed`   → ● (filled circle)
 * - `cancelled`   → ✗ (cross)
 *
 * @module components/todo-tray
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { Todo } from "@liteai/sdk"
import { useMemo } from "react"
import { useTheme } from "../context/theme"

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "◑",
  completed: "●",
  cancelled: "✗",
}

const PRIORITY_COLOR_KEY: Record<string, "error" | "warning" | "textMuted"> = {
  high: "error",
  medium: "warning",
  low: "textMuted",
}

interface TodoTrayProps {
  todos: readonly Todo[]
  expanded: boolean
}

function getCurrentTodo(todos: readonly Todo[]) {
  return (
    todos.find((todo) => todo.status === "in_progress") ??
    todos.find((todo) => todo.status === "pending") ??
    todos[todos.length - 1]
  )
}

export function TodoTray({ todos, expanded }: TodoTrayProps) {
  const { theme } = useTheme()

  const summary = useMemo(() => {
    let completed = 0
    let total = 0
    for (const t of todos) {
      total++
      if (t.status === "completed") completed++
    }
    return { completed, total }
  }, [todos])

  const visibleTodos = useMemo(() => (expanded ? todos : [getCurrentTodo(todos)].filter(Boolean)), [expanded, todos])

  if (todos.length === 0) {
    return (
      <Box paddingX={1} marginTop={1}>
        <Text color={theme.textMuted as Color} italic>
          No tasks yet.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {/* Header */}
      <Box gap={1}>
        <Text bold color={theme.text as Color}>
          Tasks
        </Text>
        <Text color={theme.textMuted as Color}>
          ({summary.completed}/{summary.total})
        </Text>
        {!expanded && <Text color={theme.textMuted as Color}>ctrl+t</Text>}
      </Box>

      {/* Todo items */}
      <Box flexDirection="column" marginTop={0}>
        {visibleTodos.map((todo, i) => {
          const icon = STATUS_ICON[todo.status] ?? "?"
          const priorityKey = PRIORITY_COLOR_KEY[todo.priority] ?? "textMuted"
          const isDone = todo.status === "completed" || todo.status === "cancelled"

          return (
            <Box key={i} gap={1}>
              <Text color={theme[priorityKey] as Color}>{icon}</Text>
              <Text
                color={(isDone ? theme.textMuted : theme.text) as Color}
                dim={isDone}
                strikethrough={todo.status === "cancelled"}
              >
                {todo.content}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
