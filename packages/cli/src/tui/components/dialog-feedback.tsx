import { Box, Text, useInput } from "@liteai/ink"
import type React from "react"
import { useCallback, useState } from "react"
import { useSDK } from "../context/sdk"
import { useSession } from "../context/session"
import { useToast } from "../context/toast"
import { Dialog } from "../ui/dialog"
import { redactSensitiveInfo } from "../util/redact"

type Step = "input" | "preview" | "submitting" | "done"

type Props = {
  onDone: () => void
}

/**
 * Multi-step feedback dialog.
 * Steps: input → preview → submitting → done
 */
export function DialogFeedback({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>("input")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const sdk = useSDK()
  const session = useSession()
  const toast = useToast()

  const submit = useCallback(async () => {
    setStep("submitting")
    setError(null)

    try {
      const body = {
        timestamp: Date.now(),
        description: redactSensitiveInfo(description),
        sessionID: session.sessionID,
        environment: {
          platform: process.platform,
          arch: process.arch,
        },
      }

      const response = await sdk.fetch(`${sdk.url}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`)
      }

      setStep("done")
      toast.show({
        variant: "success",
        message: "Feedback submitted — thank you!",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback")
      setStep("input")
    }
  }, [description, session.sessionID, sdk, toast])

  useInput((char, key) => {
    if (step === "done") {
      onDone()
      return
    }

    if (step === "submitting") return

    if (step === "preview") {
      if (key.return) {
        void submit()
      }
      return
    }

    // "input" step
    if (key.return && description.trim()) {
      setStep("preview")
      return
    }

    if (key.backspace || key.delete) {
      setDescription((prev) => prev.slice(0, -1))
      return
    }

    if (char) {
      setDescription((prev) => prev + char)
    }
  })

  return (
    <Dialog
      title="Submit Feedback"
      onCancel={() => {
        if (step === "submitting") return
        onDone()
      }}
      isCancelActive={step !== "submitting"}
    >
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {step === "input" && (
          <Box flexDirection="column" gap={1}>
            <Text>Describe the issue or feedback:</Text>
            <Box flexDirection="row" borderStyle="round" paddingX={1} borderColor="ansi:blue">
              <Text>{description || <Text dim>Enter a description...</Text>}</Text>
              <Text>█</Text>
            </Box>
            {error && <Text color="ansi:red">⚠ {error}</Text>}
            <Text dim>Press Enter to continue, Esc to cancel</Text>
          </Box>
        )}

        {step === "preview" && (
          <Box flexDirection="column" gap={1}>
            <Text bold>This report will include:</Text>
            <Box marginLeft={2} flexDirection="column">
              <Text>
                • Description: <Text dim>{redactSensitiveInfo(description)}</Text>
              </Text>
              <Text>
                • Platform:{" "}
                <Text dim>
                  {process.platform} ({process.arch})
                </Text>
              </Text>
              <Text>
                • Session: <Text dim>{session.sessionID}</Text>
              </Text>
            </Box>
            <Text dim>We redact sensitive info (API keys, tokens, paths) before saving.</Text>
            <Text>
              Press <Text bold>Enter</Text> to submit, <Text bold>Esc</Text> to cancel
            </Text>
          </Box>
        )}

        {step === "submitting" && <Text dim>Submitting feedback…</Text>}

        {step === "done" && (
          <Box flexDirection="column">
            <Text color="ansi:green">✓ Thank you for your feedback!</Text>
            <Text dim>Press any key to close.</Text>
          </Box>
        )}
      </Box>
    </Dialog>
  )
}
