import type { Color } from "@liteai/ink"
import { Box, Text, useInput } from "@liteai/ink"
import type { QuestionRequest } from "@liteai/sdk"
import React, { useMemo, useState } from "react"
import ThemedBox from "../../components/design-system/ThemedBox"
import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"

export function QuestionPrompt({ request }: { request: QuestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [selectedIdx, setSelectedIdx] = useState(0)

  const questions = request.questions
  const question = questions[0] // Simplified to first question for now
  const options = question?.options ?? []

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIdx((prev) => (prev - 1 + options.length) % options.length)
    }
    if (key.downArrow || input === "j") {
      setSelectedIdx((prev) => (prev + 1) % options.length)
    }
    if (key.return) {
      sdk.client.project.question.reply({
        projectID: sdk.projectID,
        requestID: request.id,
        answers: [[options[selectedIdx].label]],
      })
    }
    if (key.escape) {
      sdk.client.project.question.reject({
        projectID: sdk.projectID,
        requestID: request.id,
      })
    }
  })

  if (!question) return null

  return (
    <ThemedBox borderStyle="single" borderColor={theme.accent as Color} padding={1} flexDirection="column" gap={1}>
      <Text bold color={theme.accent as Color}>
        Question
      </Text>
      <Text color={theme.text as Color}>{question.question}</Text>

      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => (
          <Box key={i} gap={1}>
            <Text color={(selectedIdx === i ? theme.secondary : theme.textMuted) as Color}>
              {selectedIdx === i ? "→" : " "} {i + 1}.
            </Text>
            <Box flexDirection="column">
              <Text color={(selectedIdx === i ? theme.secondary : theme.text) as Color}>{opt.label}</Text>
              {opt.description && (
                <Text color={theme.textMuted as Color} dim>
                  {opt.description}
                </Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} gap={2}>
        <Text color={theme.textMuted as Color}>↑↓ select</Text>
        <Text color={theme.textMuted as Color}>enter confirm</Text>
        <Text color={theme.textMuted as Color}>esc dismiss</Text>
      </Box>
    </ThemedBox>
  )
}
