import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type { AssistantMessage as AssistantMessageInfo, Part, UserMessage as UserMessageInfo } from "@liteai/sdk"
import { Locale } from "@liteai/util/locale"
import { useMemo } from "react"
import { useLocal } from "../../context/local"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useKeybindingContext } from "../../keybindings/keybinding-context"
import { useSessionContext } from "./ctx"
import { PART_MAPPING } from "./parts"
import { MIME_BADGE } from "./utils"

export function UserMessageContent({
  message,
  parts,
  index,
}: {
  message: UserMessageInfo
  parts: Part[]
  index: number
  pending?: string
}) {
  const ctx = useSessionContext()
  const local = useLocal()
  const { theme } = useTheme()

  const textPart = useMemo(() => parts.find((x) => x.type === "text" && !x.synthetic), [parts])
  const files = useMemo(() => parts.filter((x) => x.type === "file"), [parts])
  const agentColor = local.agent.color(message.agent)

  return (
    <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
      <Box
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderRight={false}
        borderBottom={false}
        borderColor={agentColor as Color}
        paddingLeft={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <Box flexDirection="column">
          <Text color={theme.text as Color}>{textPart?.type === "text" ? textPart.text : ""}</Text>
          {files.length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
              {files.map((file: Extract<Part, { type: "file" }>, i: number) => {
                const bg = file.mime.startsWith("image/")
                  ? theme.accent
                  : file.mime === "application/pdf"
                    ? theme.primary
                    : theme.secondary
                return (
                  <Text key={i}>
                    <Text backgroundColor={bg as Color} color={theme.background as Color}>
                      {" "}
                      {MIME_BADGE[file.mime] ?? file.mime}{" "}
                    </Text>
                    <Text backgroundColor={theme.backgroundElement as Color} color={theme.textMuted as Color}>
                      {" "}
                      {file.filename}{" "}
                    </Text>
                  </Text>
                )
              })}
            </Box>
          )}
          {ctx.showTimestamps && (
            <Text color={theme.textMuted as Color}>{Locale.todayTimeOrDateTime(message.time.created)}</Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}

export function AssistantMessageContent({
  message,
  parts,
  last,
}: {
  message: AssistantMessageInfo
  parts: Part[]
  last: boolean
}) {
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const keybindContext = useKeybindingContext()

  const final = message.finish && !["tool-calls", "unknown"].includes(message.finish)

  const duration = useMemo(() => {
    if (!final || !message.time.completed) return 0
    const messages = sync.message[message.sessionID] ?? []
    const user = messages.find((x) => x.role === "user" && x.id === message.parentID)
    if (!user || !user.time) return 0
    return message.time.completed - user.time.created
  }, [final, message.time.completed, sync.message, message.sessionID, message.parentID])

  return (
    <Box flexDirection="column">
      {parts.map((part, index) => {
        const Component = PART_MAPPING[part.type]
        if (!Component) return null
        return <Component key={part.id} last={index === parts.length - 1} part={part} message={message} />
      })}

      {parts.some((x) => x.type === "tool" && x.tool === "task") && (
        <Box paddingTop={1} paddingLeft={3}>
          <Text color={theme.text as Color}>
            {keybindContext.getDisplayText("footer:openSelected", "Footer") || "Enter"}
            <Text color={theme.textMuted as Color}> view subagents</Text>
          </Text>
        </Box>
      )}

      {message.error && message.error.name !== "MessageAbortedError" && (
        <Box
          borderStyle="single"
          borderLeft
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={2}
          marginTop={1}
          borderColor={theme.error as Color}
          flexDirection="column"
        >
          <Text color={theme.textMuted as Color}>{(message.error.data as { message?: string })?.message ?? ""}</Text>
          <ErrorRecoveryHint error={message.error} />
        </Box>
      )}

      {(last || final || message.error?.name === "MessageAbortedError") && (
        <Box paddingLeft={3} marginTop={1}>
          <Text>
            <Text
              color={
                (message.error?.name === "MessageAbortedError"
                  ? theme.textMuted
                  : local.agent.color(message.agent)) as Color
              }
            >
              ▣{" "}
            </Text>
            <Text color={theme.text as Color}>{Locale.titlecase(message.mode)}</Text>
            <Text color={theme.textMuted as Color}> · {message.modelID}</Text>
            {duration > 0 && <Text color={theme.textMuted as Color}> · {Locale.duration(duration)}</Text>}
            {message.error?.name === "MessageAbortedError" && (
              <Text color={theme.textMuted as Color}> · interrupted</Text>
            )}
          </Text>
        </Box>
      )}
    </Box>
  )
}

// ─── Error Recovery Hints ─────────────────────────────────────────────────

type MessageError = NonNullable<AssistantMessageInfo["error"]>

/**
 * Renders a contextual recovery hint below error messages.
 * Each error type gets a specific, actionable suggestion.
 */
function ErrorRecoveryHint({ error }: { error: MessageError }) {
  const { theme } = useTheme()

  const hint = getRecoveryHint(error)
  if (!hint) return null

  return (
    <Box marginTop={1}>
      <Text color={theme.textMuted as Color}>
        {hint.icon} {hint.text}
      </Text>
    </Box>
  )
}

function getRecoveryHint(error: MessageError): { icon: string; text: string } | null {
  switch (error.name) {
    case "ContextOverflowError":
      return { icon: "⚠", text: "Context exhausted — type /compact to compact and retry" }

    case "APIError": {
      const data = error.data as { isRetryable?: boolean; message?: string }
      if (data.isRetryable) {
        return { icon: "⚠", text: "Request failed — will retry automatically" }
      }
      return { icon: "✗", text: `Request failed — ${data.message ?? "non-retryable error"}` }
    }

    case "ProviderAuthError":
      return { icon: "⚠", text: "Auth failed — type /provider to configure" }

    case "MessageOutputLengthError":
      return { icon: "⚠", text: "Output truncated — the response exceeded max output length" }

    case "StructuredOutputError":
      return { icon: "⚠", text: "Structured output parsing failed" }

    case "UnknownError":
    case "MessageAbortedError":
      return null

    default:
      return null
  }
}
