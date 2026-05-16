/**
 * PlanReview — bordered plan approval dialog.
 *
 * Renders when the backend emits a `plan.approval_requested` event.
 * Shows the plan text in a bordered box with approve/reject/edit actions.
 *
 * @module components/plan-review
 */

import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useState } from "react"
import ThemedBox from "../components/design-system/ThemedBox"
import { useTheme } from "../context/theme"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"

interface PlanReviewProps {
  planText: string
  planFilePath: string
  onApprove: () => void
  onReject: () => void
}

type PlanAction = "approve" | "reject"

export function PlanReview({ planText, planFilePath, onApprove, onReject }: PlanReviewProps) {
  const { theme } = useTheme()
  const [selected, setSelected] = useState<PlanAction>("approve")

  const actions: PlanAction[] = ["approve", "reject"]

  useRegisterKeybindingContext("Select")
  useKeybindings(
    {
      "select:previous": () => {
        const idx = actions.indexOf(selected)
        setSelected(actions[(idx - 1 + actions.length) % actions.length])
      },
      "select:next": () => {
        const idx = actions.indexOf(selected)
        setSelected(actions[(idx + 1) % actions.length])
      },
      "select:accept": () => {
        if (selected === "approve") onApprove()
        else onReject()
      },
      "select:cancel": () => {
        onReject()
      },
    },
    { context: "Select" },
  )

  // Truncate plan text for display — show first 30 lines max
  const lines = planText.split("\n")
  const truncated = lines.length > 30
  const displayText = truncated ? [...lines.slice(0, 30), `\n… (${lines.length - 30} more lines)`].join("\n") : planText

  return (
    <ThemedBox borderStyle="round" borderColor={theme.primary as Color} padding={1} flexDirection="column" gap={1}>
      {/* Header */}
      <Box gap={1}>
        <Text color={theme.primary as Color}>◆</Text>
        <Text bold>Plan Review</Text>
        <Text color={theme.textMuted as Color}>— {planFilePath}</Text>
      </Box>

      {/* Plan content */}
      <Box
        paddingX={1}
        marginTop={0}
        flexDirection="column"
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderRight={false}
        borderBottom={false}
        borderColor={theme.backgroundElement as Color}
      >
        <Text color={theme.text as Color}>{displayText}</Text>
      </Box>

      {/* Action buttons */}
      <Box gap={2} marginTop={1}>
        {actions.map((action) => (
          <Box
            key={action}
            paddingX={1}
            backgroundColor={
              selected === action
                ? action === "approve"
                  ? (theme.primary as Color)
                  : (theme.error as Color)
                : undefined
            }
          >
            <Text color={(selected === action ? theme.background : theme.textMuted) as Color}>
              {action === "approve" ? "✓ Approve" : "✗ Reject"}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Footer hints */}
      <Box gap={2} marginTop={0}>
        <Text color={theme.textMuted as Color}>←/→ select</Text>
        <Text color={theme.textMuted as Color}>enter confirm</Text>
        <Text color={theme.textMuted as Color}>esc reject</Text>
      </Box>
    </ThemedBox>
  )
}
