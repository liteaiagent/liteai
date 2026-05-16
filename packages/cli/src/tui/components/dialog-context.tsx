import { Box, Text } from "@liteai/ink"
import { Log } from "@liteai/util/log"
import type React from "react"
import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
import { useSession } from "../context/session"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybinding } from "../keybindings/use-keybinding"
import { ContextUsageDisplay } from "./context-usage-display"
import { Pane } from "./design-system/Pane"

type ContextBreakdownInfo = {
  totalTokens: number
  contextLimit: number
  utilization: number
  categories: { label: string; tokens: number; percent: number }[]
  modelID: string
  providerID: string
}

type Props = {
  onClose: () => void
}

export function DialogContext({ onClose }: Props): React.ReactNode {
  const sdk = useSDK()
  const session = useSession()
  const [breakdown, setBreakdown] = useState<ContextBreakdownInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useRegisterKeybindingContext("Confirmation")
  useKeybinding("confirm:no", () => onClose(), { context: "Confirmation" })

  useEffect(() => {
    if (!session.sessionID) return
    const fetchContext = async () => {
      try {
        const response = await sdk.fetch(`${sdk.url}/session/${session.sessionID}/context`)
        if (response.ok) {
          const data = await response.json()
          setBreakdown(data as ContextBreakdownInfo)
        }
      } catch (e) {
        Log.Default.warn("[dialog-context] Failed to fetch context breakdown", {
          sessionID: session.sessionID,
          error: e,
        })
      } finally {
        setLoading(false)
      }
    }
    void fetchContext()
  }, [sdk, session.sessionID])

  return (
    <Pane color="info">
      <Box flexDirection="column" gap={1} marginTop={1}>
        {loading ? (
          <Text dim>Loading context breakdown...</Text>
        ) : breakdown ? (
          <>
            <ContextUsageDisplay utilization={breakdown.utilization} contextLimit={breakdown.contextLimit} />
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" borderBottom={false} paddingBottom={0} marginBottom={1}>
                <Box width={20}>
                  <Text bold>Category</Text>
                </Box>
                <Box width={15}>
                  <Text bold>Tokens</Text>
                </Box>
                <Box width={10}>
                  <Text bold>%</Text>
                </Box>
              </Box>
              {breakdown.categories.map((cat, idx) => (
                <Box key={idx} flexDirection="row">
                  <Box width={20}>
                    <Text>{cat.label}</Text>
                  </Box>
                  <Box width={15}>
                    <Text>{cat.tokens.toLocaleString()}</Text>
                  </Box>
                  <Box width={10}>
                    <Text>{cat.percent.toFixed(1)}%</Text>
                  </Box>
                </Box>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text dim>Model: {breakdown.modelID}</Text>
            </Box>
          </>
        ) : (
          <Text color="ansi:red">Failed to load context breakdown</Text>
        )}
      </Box>
    </Pane>
  )
}
