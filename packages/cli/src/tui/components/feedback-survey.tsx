import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSDK } from "../context/sdk"
import { useSession } from "../context/session"

/** The debounce window (ms) for digit inputs to prevent accidental presses. */
const DEBOUNCE_MS = 300

type SurveyResponse = "bad" | "fine" | "good" | "dismissed"

const DIGIT_MAP: Record<string, SurveyResponse> = {
  "1": "bad",
  "2": "fine",
  "3": "good",
  "0": "dismissed",
}

type Props = {
  /** Called when the survey is dismissed or auto-hidden. */
  onDismiss: () => void
}

/**
 * Inline session-level feedback survey rendered below the prompt input.
 * Follows Claude Code pattern: digit-key driven, auto-dismissing.
 *
 * Display: `● How is LiteAI doing this session? (optional)`
 *          `  1: Bad · 2: Fine · 3: Good · 0: Dismiss`
 */
export function FeedbackSurvey({ onDismiss }: Props): React.ReactNode {
  const [state, setState] = useState<"open" | "thanks">("open")
  const [lastResponse, setLastResponse] = useState<SurveyResponse | null>(null)
  const lastDigitRef = useRef<number>(0)
  const sdk = useSDK()
  const session = useSession()

  const submitSurvey = useCallback(
    async (response: SurveyResponse) => {
      try {
        await sdk.fetch(`${sdk.url}/feedback/survey`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionID: session.sessionID,
            response,
            timestamp: Date.now(),
          }),
        })
      } catch {
        // Survey submission failures are non-critical; swallow silently
      }
    },
    [sdk, session.sessionID],
  )

  const handleSelect = useCallback(
    (response: SurveyResponse) => {
      setLastResponse(response)
      void submitSurvey(response)

      if (response === "dismissed") {
        onDismiss()
        return
      }

      setState("thanks")
    },
    [submitSurvey, onDismiss],
  )

  // Auto-dismiss the "thanks" state after 3 seconds
  useEffect(() => {
    if (state !== "thanks") return
    const timer = setTimeout(() => {
      onDismiss()
    }, 3000)
    return () => clearTimeout(timer)
  }, [state, onDismiss])

  useInput((char) => {
    if (state !== "open") return

    const response = DIGIT_MAP[char]
    if (!response) return

    // Debounce: ignore if the same digit was pressed within DEBOUNCE_MS
    const now = Date.now()
    if (now - lastDigitRef.current < DEBOUNCE_MS) return
    lastDigitRef.current = now

    handleSelect(response)
  })

  if (state === "thanks") {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="ansi:green">Thanks for the feedback!</Text>
        {lastResponse === "bad" && <Text dim>Use /feedback to share more details about what went wrong.</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="ansi:cyan">● </Text>
        <Text bold>How is LiteAI doing this session? (optional)</Text>
      </Box>
      <Box marginLeft={2} gap={2}>
        <Box width={10}>
          <Text>
            <Text color="ansi:cyan">1</Text>: Bad
          </Text>
        </Box>
        <Box width={10}>
          <Text>
            <Text color="ansi:cyan">2</Text>: Fine
          </Text>
        </Box>
        <Box width={10}>
          <Text>
            <Text color="ansi:cyan">3</Text>: Good
          </Text>
        </Box>
        <Box>
          <Text>
            <Text color="ansi:cyan">0</Text>: Dismiss
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
