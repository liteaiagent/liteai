import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { AssistantMessage, CompactionPart, ReasoningPart, TextPart, ToolPart } from "@liteai/sdk"
import type React from "react"
import { useMemo } from "react"
import { CollapsedGroupView } from "../../components/collapsed-group-view"
import { CompactSummary } from "../../components/compact-summary"
import { Markdown } from "../../components/markdown"
import { useTheme } from "../../context/theme.tsx"
import { selectPermissions, useAppState } from "../../state"
import { mapToolPartToDisplayStatus } from "../../utils/tool-display-status"
import { useSessionContext } from "./ctx"
import { UnifiedToolView } from "./tools"

// biome-ignore lint/suspicious/noExplicitAny: Part subtype narrowing happens at call site via discriminated union; the mapping boundary intentionally accepts the broad Part type
export const PART_MAPPING: Record<string, React.FC<any>> = {
  text: TextPartView,
  tool: ToolPartView,
  reasoning: ReasoningPartView,
  compaction: CompactionPartView,
  "tool-group": CollapsedGroupView,
}

function CompactionPartView({ part }: { part: CompactionPart }) {
  return <CompactSummary auto={part.auto} overflow={part.overflow} />
}

function extractThinkingTitle(text: string, maxLen = 60): string {
  const cleaned = text.replace("[REDACTED]", "").trim()
  const match = cleaned.match(/^(.+?[.!?\n])/s)
  const sentence = match ? match[1].replace(/\n/g, " ").trim() : cleaned
  return sentence.length > maxLen ? `${sentence.slice(0, maxLen - 1)}…` : sentence
}

function ReasoningPartView({ part, message }: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const ctx = useSessionContext()

  const content = useMemo(() => {
    return part.text.replace("[REDACTED]", "").trim()
  }, [part.text])

  // Master override: global showThinking gates all rendering
  if (!content && !part.text.includes("[REDACTED]")) return null
  if (!ctx.showThinking) return null

  // Hide as past if a latest reasoning exists and this isn't it
  if (ctx.lastReasoningId && ctx.lastReasoningId !== part.id) return null

  const tokenCount = message.tokens.reasoning
  const formattedTokens = tokenCount > 0 ? tokenCount.toLocaleString() : "…"

  if (!ctx.showDetails) {
    const title = extractThinkingTitle(part.text)
    const displayTitle = title ? `: ${title}` : ""
    return (
      <Box paddingLeft={3} marginTop={1}>
        <Text color={theme.textMuted as Color} italic>
          ▶ Thinking{displayTitle} ({formattedTokens} tokens)
        </Text>
      </Box>
    )
  }

  return (
    <Box
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
      borderStyle="single"
      borderLeft
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      borderColor={theme.backgroundElement as Color}
    >
      <Box>
        <Text color={theme.textMuted as Color} italic>
          ▼ Thinking ({formattedTokens} tokens)
        </Text>
      </Box>
      <Text color={theme.textMuted as Color} italic>
        {content}
      </Text>
    </Box>
  )
}

function TextPartView({ part }: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const _ctx = useSessionContext()

  if (!part.text.trim()) return null

  return (
    <Box paddingLeft={3} marginTop={1} flexShrink={0}>
      <Markdown>{part.text.trim()}</Markdown>
    </Box>
  )
}

function ToolPartView({ part, message }: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const permissions = useAppState(selectPermissions(message.sessionID))

  const status = mapToolPartToDisplayStatus(part, permissions)

  const toolprops = {
    metadata: part.state.status === "pending" ? {} : (part.state.metadata ?? {}),
    input: part.state.input ?? {},
    output: part.state.status === "completed" ? part.state.output : undefined,
    permission: permissions.find((x) => x.tool?.callID === part.callID),
    tool: part.tool,
    part: part,
  }

  return <UnifiedToolView toolprops={toolprops} status={status} />
}
