/**
 * QuestionPrompt — multi-question support with counter-style navigation.
 *
 * Supports one-at-a-time question flow with a `Question 2/3:` counter header.
 * Each question can have predefined options, free-form custom input, or both.
 * Answers are submitted all at once after the final question is answered.
 *
 * @module routes/session/question
 */

import type { Color } from "@liteai/ink"
import { Box, TerminalSizeContext, Text } from "@liteai/ink"
import type { QuestionRequest } from "@liteai/sdk"
import { useCallback, useContext, useMemo, useState } from "react"
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

  const questions = request.questions
  const totalQuestions = questions.length

  // Multi-question state: track current question index and accumulated answers
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<string[]>(() => Array(totalQuestions).fill(""))

  // Per-question UI state
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [customText, setCustomText] = useState("")
  const [cursorOffset, setCursorOffset] = useState(0)
  const [mode, setMode] = useState<InputMode>("options")

  const question = questions[currentIdx]
  const options = question?.options ?? []
  const allowCustom = question?.custom !== false

  const resetQuestionUI = useCallback(() => {
    setSelectedIdx(0)
    setCustomText("")
    setCursorOffset(0)
    setMode(options.length > 0 ? "options" : "custom")
  }, [options.length])

  // Submit all answers to backend
  const submitAll = useCallback(
    (finalAnswers: string[]) => {
      sdk.client.project.question.reply({
        projectID: sdk.projectID,
        requestID: request.id,
        answers: finalAnswers.map((a) => [a]),
      })
    },
    [sdk, request.id],
  )

  // Record answer for current question and advance or submit
  const recordAnswer = useCallback(
    (answer: string) => {
      if (!answer.trim()) return
      const updated = [...answers]
      updated[currentIdx] = answer
      setAnswers(updated)

      if (currentIdx < totalQuestions - 1) {
        // Advance to next question
        setCurrentIdx(currentIdx + 1)
        resetQuestionUI()
      } else {
        // All questions answered — submit
        submitAll(updated)
      }
    },
    [answers, currentIdx, totalQuestions, resetQuestionUI, submitAll],
  )

  const reject = useCallback(() => {
    sdk.client.project.question.reject({
      projectID: sdk.projectID,
      requestID: request.id,
    })
  }, [sdk, request.id])

  // Navigate back to previous question
  const goBack = useCallback(() => {
    if (currentIdx > 0) {
      setCurrentIdx(currentIdx - 1)
      resetQuestionUI()
    }
  }, [currentIdx, resetQuestionUI])

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
            recordAnswer(selected.label)
          }
        }
      },
      "select:cancel": () => {
        if (currentIdx > 0) {
          goBack()
        } else {
          reject()
        }
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

  // Custom input mode: up arrow or tab returns to option list; esc goes back or rejects
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
        else if (currentIdx > 0) goBack()
        else reject()
      },
    },
    { context: "Select", isActive: mode === "custom" },
  )

  const handleCustomSubmit = useCallback(
    (value: string) => {
      recordAnswer(value)
    },
    [recordAnswer],
  )

  // Counter header text
  const headerText = useMemo(() => {
    if (totalQuestions <= 1) return "Question"
    return `Question ${currentIdx + 1}/${totalQuestions}`
  }, [currentIdx, totalQuestions])

  if (!question) return null

  const agentName = (request as QuestionRequest & { agentName?: string }).agentName

  return (
    <ThemedBox borderStyle="round" borderColor={theme.accent as Color} padding={1} flexDirection="column" gap={1}>
      {/* Header with counter */}
      <Box flexDirection="row" gap={1}>
        <Text bold color={theme.accent as Color}>
          {headerText}
        </Text>
        {agentName && <Text color={theme.primary as Color}>[{agentName}]</Text>}
        {/* Progress dots for multi-question */}
        {totalQuestions > 1 && (
          <Text color={theme.textMuted as Color}>
            {questions.map((_, i) => (i < currentIdx ? "●" : i === currentIdx ? "◉" : "○")).join(" ")}
          </Text>
        )}
      </Box>

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
        {currentIdx > 0 && <Text color={theme.textMuted as Color}>esc back</Text>}
        <Text color={theme.textMuted as Color}>{currentIdx === 0 ? "esc dismiss" : ""}</Text>
      </Box>
    </ThemedBox>
  )
}
