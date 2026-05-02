import type { AssistantMessage, Message, Part, ReasoningPart, TextPart, ToolPart } from "@liteai/sdk"

export function formatSessionExport(
  messages: Message[],
  parts: Record<string, Part[]>,
  options: { thinking: boolean; toolDetails: boolean; assistantMetadata: boolean },
): string {
  const lines: string[] = ["# LiteAI Session Export\n"]
  for (const msg of messages) {
    const role = msg.role === "user" ? "## User" : "## Assistant"
    lines.push(`${role}\n`)
    const msgParts = parts[msg.id] ?? []
    for (const part of msgParts) {
      if (part.type === "text") {
        lines.push((part as TextPart).text ?? "")
      }
      if (part.type === "reasoning" && options.thinking) {
        lines.push(`> *Thinking:* ${(part as ReasoningPart).text ?? ""}`)
      }
      if (part.type === "tool" && options.toolDetails) {
        const toolPart = part as ToolPart
        lines.push(`\`\`\`\n${toolPart.tool}: ${JSON.stringify(toolPart.state?.input, null, 2)}\n\`\`\``)
      }
    }
    if (options.assistantMetadata && msg.role === "assistant") {
      const assistant = msg as AssistantMessage
      const totalTokens = assistant.tokens
        ? assistant.tokens.input + assistant.tokens.output + assistant.tokens.reasoning
        : "?"
      lines.push(`\n*Model: ${assistant.modelID ?? "unknown"} | Tokens: ${totalTokens}*\n`)
    }
    lines.push("---\n")
  }
  return lines.join("\n")
}
