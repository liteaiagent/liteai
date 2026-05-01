import type { MessageActionContext } from "./message-action-registry"
import { extractCodeBlocks, extractCopyText, getApplicableActions } from "./message-action-registry"

export type MessageActionCaps = {
  copy: (text: string) => Promise<void>
  retry: (userMessageId: string) => void
  edit: (text: string) => void // prefill prompt via PromptRef.prefill()
}

/**
 * Dispatch an action on a message.
 * Returns true if the action was handled.
 */
export function dispatchMessageAction(
  actionKey: string,
  ctx: MessageActionContext,
  caps: MessageActionCaps,
  toggleExpand: () => void,
): boolean {
  const applicable = getApplicableActions(ctx)
  const actionDef = applicable.find((a) => a.key === actionKey)

  if (!actionDef) return false

  switch (actionKey) {
    case "copy": {
      const text = extractCopyText(ctx.message, ctx.parts)
      if (text) void caps.copy(text)
      break
    }
    case "copyCode": {
      const code = extractCodeBlocks(ctx.parts)
      if (code) void caps.copy(code)
      break
    }
    case "primary": {
      if (ctx.message.role === "assistant") {
        toggleExpand()
      } else if (ctx.message.role === "user") {
        const text = extractCopyText(ctx.message, ctx.parts)
        if (text) caps.edit(text)
      }
      break
    }
    case "retry": {
      if (ctx.message.role === "assistant" && ctx.message.parentID) {
        caps.retry(ctx.message.parentID)
      }
      break
    }
  }

  return true
}
