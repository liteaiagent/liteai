import type { Message, Part } from "@liteai/sdk/client"

export type SessionContextBreakdownKey = "system" | "user" | "assistant" | "thinking" | "tool" | "defs" | "other"

export type SessionContextBreakdownSegment = {
  key: SessionContextBreakdownKey
  tokens: number
  width: number
  percent: number
}

const estimateTokens = (chars: number) => Math.ceil(chars / 4)
const toPercent = (tokens: number, input: number) => (tokens / input) * 100
const toPercentLabel = (tokens: number, input: number) => Math.round(toPercent(tokens, input) * 10) / 10

const charsFromUserPart = (part: Part) => {
  if (part.type === "text") return part.text.length
  if (part.type === "file") return part.source?.text.value.length ?? 0
  if (part.type === "agent") return part.source?.value.length ?? 0
  return 0
}

const charsFromAssistantPart = (part: Part) => {
  if (part.type === "text") return { assistant: part.text.length, thinking: 0, tool: 0 }
  if (part.type === "reasoning") return { assistant: 0, thinking: part.text.length, tool: 0 }
  if (part.type !== "tool") return { assistant: 0, thinking: 0, tool: 0 }

  const input = Object.keys(part.state.input).length * 16
  if (part.state.status === "pending") return { assistant: 0, thinking: 0, tool: input + part.state.raw.length }
  if (part.state.status === "completed") return { assistant: 0, thinking: 0, tool: input + part.state.output.length }
  if (part.state.status === "error") return { assistant: 0, thinking: 0, tool: input + part.state.error.length }
  return { assistant: 0, thinking: 0, tool: input }
}

const build = (
  tokens: {
    system: number
    user: number
    assistant: number
    thinking: number
    tool: number
    defs: number
    other: number
  },
  input: number,
) => {
  return [
    {
      key: "system",
      tokens: tokens.system,
    },
    {
      key: "user",
      tokens: tokens.user,
    },
    {
      key: "assistant",
      tokens: tokens.assistant,
    },
    {
      key: "thinking",
      tokens: tokens.thinking,
    },
    {
      key: "tool",
      tokens: tokens.tool,
    },
    {
      key: "defs",
      tokens: tokens.defs,
    },
    {
      key: "other",
      tokens: tokens.other,
    },
  ]
    .filter((x) => x.tokens > 0)
    .map((x) => ({
      key: x.key,
      tokens: x.tokens,
      width: toPercent(x.tokens, input),
      percent: toPercentLabel(x.tokens, input),
    })) as SessionContextBreakdownSegment[]
}

const estimateToolDefsChars = (defs: Record<string, unknown>[] | null | undefined) => {
  if (!defs?.length) return 0
  return defs.reduce((sum, def) => sum + JSON.stringify(def).length, 0)
}

export function estimateSessionContextBreakdown(args: {
  messages: Message[]
  parts: Record<string, Part[] | undefined>
  input: number
  systemPrompt?: string
  toolDefs?: Record<string, unknown>[] | null
}) {
  if (!args.input) return []

  const counts = args.messages.reduce(
    (acc, msg) => {
      const parts = args.parts[msg.id] ?? []
      if (msg.role === "user") {
        const user = parts.reduce((sum, part) => sum + charsFromUserPart(part), 0)
        acc.user += user
        return acc
      }

      if (msg.role !== "assistant") return acc
      const assistant = parts.reduce(
        (sum, part) => {
          const next = charsFromAssistantPart(part)
          sum.assistant += next.assistant
          sum.thinking += next.thinking
          sum.tool += next.tool
          return sum
        },
        { assistant: 0, thinking: 0, tool: 0 },
      )
      acc.assistant += assistant.assistant
      acc.thinking += assistant.thinking
      acc.tool += assistant.tool
      return acc
    },
    {
      system: args.systemPrompt?.length ?? 0,
      user: 0,
      assistant: 0,
      thinking: 0,
      tool: 0,
    },
  )

  const tokens = {
    system: estimateTokens(counts.system),
    user: estimateTokens(counts.user),
    assistant: estimateTokens(counts.assistant),
    thinking: estimateTokens(counts.thinking),
    tool: estimateTokens(counts.tool),
    defs: estimateTokens(estimateToolDefsChars(args.toolDefs)),
  }
  const estimated = tokens.system + tokens.user + tokens.assistant + tokens.thinking + tokens.tool + tokens.defs

  if (estimated <= args.input) {
    return build({ ...tokens, other: args.input - estimated }, args.input)
  }

  const scale = args.input / estimated
  const scaled = {
    system: Math.floor(tokens.system * scale),
    user: Math.floor(tokens.user * scale),
    assistant: Math.floor(tokens.assistant * scale),
    thinking: Math.floor(tokens.thinking * scale),
    tool: Math.floor(tokens.tool * scale),
    defs: Math.floor(tokens.defs * scale),
  }
  const total = scaled.system + scaled.user + scaled.assistant + scaled.thinking + scaled.tool + scaled.defs
  return build({ ...scaled, other: Math.max(0, args.input - total) }, args.input)
}
