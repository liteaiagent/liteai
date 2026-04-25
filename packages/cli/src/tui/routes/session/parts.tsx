import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { AssistantMessage, ReasoningPart, TextPart, ToolPart } from "@liteai/sdk"
import type React from "react"
import { useMemo } from "react"
import { Markdown } from "../../components/markdown"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme.tsx"
import { useSessionContext } from "./ctx"
import {
  ApplyPatch,
  CodeSearch,
  CommandStatus,
  Edit,
  GenericTool,
  Glob,
  Grep,
  List,
  Question,
  Read,
  RunCommand,
  SendCommandInput,
  Skill,
  Task,
  TodoWrite,
  WebFetch,
  WebSearch,
  Write,
} from "./tools"

// biome-ignore lint/suspicious/noExplicitAny: Part subtype narrowing happens at call site via discriminated union; the mapping boundary intentionally accepts the broad Part type
export const PART_MAPPING: Record<string, React.FC<any>> = {
  text: TextPartView,
  tool: ToolPartView,
  reasoning: ReasoningPartView,
}

function ReasoningPartView({ last, part, message }: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme } = useTheme()
  const ctx = useSessionContext()
  const content = useMemo(() => {
    return part.text.replace("[REDACTED]", "").trim()
  }, [part.text])

  if (!content || !ctx.showThinking) return null

  return (
    <Box
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.backgroundElement as Color}
    >
      <Text color={theme.textMuted as Color} italic>
        Thinking: {content}
      </Text>
    </Box>
  )
}

function TextPartView({ last, part, message }: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = useSessionContext()
  const { theme } = useTheme()

  if (!part.text.trim()) return null

  return (
    <Box paddingLeft={3} marginTop={1} flexShrink={0}>
      <Markdown>{part.text.trim()}</Markdown>
    </Box>
  )
}

function ToolPartView({ last, part, message }: { last: boolean; part: ToolPart; message: AssistantMessage }) {
  const ctx = useSessionContext()
  const sync = useSync()

  const hidden = useMemo(() => {
    if (ctx.showDetails) return false
    if (part.state.status !== "completed") return false
    return true
  }, [ctx, part.state.status])

  if (hidden) return null

  const toolprops = {
    metadata: part.state.status === "pending" ? {} : (part.state.metadata ?? {}),
    input: part.state.input ?? {},
    output: part.state.status === "completed" ? part.state.output : undefined,
    permission: (sync.permission[message.sessionID] ?? []).find((x) => x.tool?.callID === part.callID),
    tool: part.tool,
    part: part,
  }

  switch (part.tool) {
    case "run_command":
      return <RunCommand {...toolprops} />
    case "command_status":
      return <CommandStatus {...toolprops} />
    case "send_command_input":
      return <SendCommandInput {...toolprops} />
    case "glob":
      return <Glob {...toolprops} />
    case "read":
      return <Read {...toolprops} />
    case "grep":
      return <Grep {...toolprops} />
    case "list":
      return <List {...toolprops} />
    case "webfetch":
      return <WebFetch {...toolprops} />
    case "codesearch":
      return <CodeSearch {...toolprops} />
    case "websearch":
      return <WebSearch {...toolprops} />
    case "write":
      return <Write {...toolprops} />
    case "edit":
      return <Edit {...toolprops} />
    case "task":
      return <Task {...toolprops} />
    case "apply_patch":
      return <ApplyPatch {...toolprops} />
    case "todowrite":
      return <TodoWrite {...toolprops} />
    case "ask_user":
      return <Question {...toolprops} />
    case "skill":
      return <Skill {...toolprops} />
    default:
      return <GenericTool {...toolprops} />
  }
}
