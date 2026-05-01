import type { Message, Part } from "@liteai/sdk"

export type MessageActionContext = {
  message: Message
  parts: Part[]
  isExpanded: boolean
}

export type MessageActionDef = {
  /** Keybinding action name (maps to messageActions:xxx) */
  key: string
  /** Display label — static string or dynamic function */
  label: string | ((ctx: MessageActionContext) => string)
  /** Which message roles this action applies to */
  roles: ReadonlyArray<"user" | "assistant">
  /** Additional filter — return false to hide the action */
  applies?: (ctx: MessageActionContext) => boolean
  /** If true, cursor mode stays active after action executes (for expand/collapse) */
  stays?: true
}

export const MESSAGE_ACTIONS: MessageActionDef[] = [
  {
    key: "copy",
    label: "copy",
    roles: ["user", "assistant"],
    applies: () => true, // extractCopyText handles filtering if needed
  },
  {
    key: "copyCode",
    label: "copy code",
    roles: ["assistant"],
    applies: (ctx) => extractCodeBlocks(ctx.parts).length > 0,
  },
  {
    key: "primary",
    label: (ctx) => (ctx.isExpanded ? "collapse" : "expand"),
    roles: ["assistant"],
    applies: (ctx) => ctx.parts.some((p) => p.type === "tool" && p.state.status !== "pending"),
    stays: true,
  },
  {
    key: "primary",
    label: "edit",
    roles: ["user"],
    applies: () => true,
  },
  {
    key: "retry",
    label: "retry",
    roles: ["assistant"],
    applies: (ctx) => isRetryableError(ctx.message),
  },
]

/** Filter actions applicable to a given message context */
export function getApplicableActions(ctx: MessageActionContext): MessageActionDef[] {
  return MESSAGE_ACTIONS.filter((action) => {
    if (!action.roles.includes(ctx.message.role)) return false
    if (action.applies && !action.applies(ctx)) return false
    return true
  })
}

/** Extract copyable text from a message */
export function extractCopyText(message: Message, parts: Part[]): string {
  if (message.role === "user") {
    const textPart = parts.find((p) => p.type === "text" && !p.synthetic && !p.ignored)
    if (textPart && textPart.type === "text") return textPart.text
    return ""
  }

  // Assistant messages
  let result = ""
  for (const part of parts) {
    if (part.type === "text") {
      result += part.text
    } else if (part.type === "tool" && part.state.status === "completed") {
      result += `\n\n> Output from ${part.tool}:\n${part.state.output}`
    }
  }
  return result.trim()
}

/** Extract only code blocks from assistant message text parts */
export function extractCodeBlocks(parts: Part[]): string {
  let result = ""
  for (const part of parts) {
    if (part.type === "text") {
      const matches = Array.from(part.text.matchAll(/```[a-z0-9-]*\n([\s\S]*?)\n```/gi))
      for (const match of matches) {
        if (match[1]) result += `${match[1]}\n\n`
      }
    }
  }
  return result.trim()
}

/** Check if a message has a retryable error */
export function isRetryableError(message: Message): boolean {
  if (message.role !== "assistant" || !message.error) return false

  const err = message.error
  if (err.name === "ContextOverflowError") return true
  if (err.name === "APIError" && (err.data as { isRetryable?: boolean }).isRetryable) return true

  // Let other errors be retryable as a fallback just in case, similar to the existing retry logic
  if (err.name === "UnknownError") return true

  return false
}
