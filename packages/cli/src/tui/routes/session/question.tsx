import type { Color } from "@liteai/ink"
import { Box, TerminalSizeContext, Text } from "@liteai/ink"
import type { QuestionRequest } from "@liteai/sdk"
import { useCallback, useContext, useState } from "react"
import ThemedBox from "../../components/design-system/ThemedBox"
import { TextInput } from "../../components/text-input"
import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"
import { useRegisterKeybindingContext } from "../../keybindings/keybinding-context"
import { useKeybindings } from "../../keybindings/use-keybinding"

type InputMode = "options" | "custom"

export function QuestionPrompt({ request }: { request: QuestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const terminalSize = useContext(TerminalSizeContext)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [customText, setCustomText] = useState("")
  const [cursorOffset, setCursorOffset] = useState(0)
  const [mode, setMode] = useState<InputMode>("options")

  const questions = request.questions
  const question = questions[0] // Simplified to first question for now
  const options = question?.options ?? []
  // custom defaults to true per API spec — allow typing a free-form answer
  const allowCustom = question?.custom !== false

  const submitAnswer = useCallback(
    (answer: string) => {
      if (!answer.trim()) return
      sdk.client.project.question.reply({
        projectID: sdk.projectID,
        requestID: request.id,
        answers: [[answer]],
      })
    },
    [sdk, request.id],
  )

  const reject = useCallback(() => {
    sdk.client.project.question.reject({
      projectID: sdk.projectID,
      requestID: request.id,
    })
  }, [sdk, request.id])

  useRegisterKeybindingContext("Select", mode === "options")
  useKeybindings(
    {
      "select:previous": () => {
        setSelectedIdx((prev) => (prev - 1 + options.length) % options.length)
      },
      "select:next": () => {
        if (allowCustom) {
          setSelectedIdx((prev) => {
            if (prev === options.length - 1) {
              setMode("custom")
              return prev
            }
            return prev + 1
          })
        } else {
          setSelectedIdx((prev) => (prev + 1) % options.length)
        }
      },
      "select:accept": () => {
        if (options.length > 0) {
          const selected = options[selectedIdx]
          if (selected) {
            submitAnswer(selected.label)
          }
        }
      },
      "select:cancel": () => {
        reject()
      },
    },
    { context: "Select", isActive: mode === "options" },
  )

  // Tab key: switch between options and custom input modes
  useKeybindings(
    {
      "tabs:next": () => {
        if (allowCustom) setMode("custom")
      },
    },
    { context: "Tabs", isActive: mode === "options" },
  )

  // Custom input mode: up arrow or tab returns to option list; esc rejects
  useKeybindings(
    {
      "select:previous": () => setMode("options"),
      "tabs:next": () => {
        if (options.length > 0) setMode("options")
      },
      "tabs:previous": () => {
        if (options.length > 0) setMode("options")
      },
      "select:cancel": () => {
        if (customText) setCustomText("")
        else reject()
      },
    },
    { context: "Select", isActive: mode === "custom" },
  )

  const handleCustomSubmit = useCallback(
    (value: string) => {
      submitAnswer(value)
    },
    [submitAnswer],
  )

  if (!question) return null

  return (
    <ThemedBox borderStyle="single" borderColor={theme.accent as Color} padding={1} flexDirection="column" gap={1}>
      <Text bold color={theme.accent as Color}>
        Question
      </Text>
      <Text color={theme.text as Color}>{question.question}</Text>

      {options.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {options.map((opt, i) => {
            const isSelected = mode === "options" && selectedIdx === i
            return (
              <Box key={i} gap={1}>
                <Text color={(isSelected ? theme.secondary : theme.textMuted) as Color}>
                  {isSelected ? "→" : " "} {i + 1}.
                </Text>
                <Box flexDirection="column">
                  <Text color={(isSelected ? theme.secondary : theme.text) as Color}>{opt.label}</Text>
                  {opt.description && (
                    <Text color={theme.textMuted as Color} dim>
                      {opt.description}
                    </Text>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}

      {allowCustom && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={(mode === "custom" ? theme.secondary : theme.textMuted) as Color}>
            {mode === "custom" ? "→" : " "} Type your answer:
          </Text>
          <Box marginLeft={2} marginTop={0}>
            <Text color={theme.secondary as Color}>{"❯ "}</Text>
            <TextInput
              value={customText}
              onChange={setCustomText}
              onSubmit={handleCustomSubmit}
              focus={mode === "custom"}
              showCursor
              multiline={false}
              columns={(terminalSize?.columns ?? 80) - 8}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
          </Box>
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        {options.length > 0 && <Text color={theme.textMuted as Color}>↑↓ select</Text>}
        {allowCustom && options.length > 0 && <Text color={theme.textMuted as Color}>tab switch</Text>}
        <Text color={theme.textMuted as Color}>enter confirm</Text>
        <Text color={theme.textMuted as Color}>esc dismiss</Text>
      </Box>
    </ThemedBox>
  )
}
