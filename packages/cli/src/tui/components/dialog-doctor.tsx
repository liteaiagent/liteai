import { type Color, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useState } from "react"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { SelectPane } from "../ui/select-pane"

type DiagResult = {
  name: string
  status: "ok" | "warn" | "error"
  message: string
  details?: string
}

type Props = {
  onClose: () => void
}

export function DialogDoctor({ onClose }: Props): React.ReactNode {
  const sdk = useSDK()
  const { theme } = useTheme()
  const [results, setResults] = useState<DiagResult[] | null>(null)

  useEffect(() => {
    sdk
      .fetch(`${sdk.url}/diagnostics`)
      .then((r) => r.json())
      // biome-ignore lint/suspicious/noExplicitAny: diagnostics endpoint not in SDK
      .then((r) => setResults((r as any)?.data ?? []))
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        setResults([{ name: "Diagnostics", status: "error", message: `Failed to fetch: ${message}` }])
      })
  }, [sdk])

  if (!results) return <Text color={theme.textMuted as Color}>Running diagnostics…</Text>

  const statusIcon = (s: string) => (s === "ok" ? "✓" : s === "warn" ? "⚠" : "✗")

  return (
    <SelectPane
      title="Doctor — System Diagnostics"
      skipFilter
      items={results.map((r) => ({
        key: r.name,
        value: r.name,
        label: `${statusIcon(r.status)} ${r.name}`,
        description: r.message,
      }))}
      onSelect={() => {}}
      onClose={onClose}
      footerContent={
        <Text color={theme.textMuted as Color}>
          {results.filter((r) => r.status === "error").length} errors ·
          {results.filter((r) => r.status === "warn").length} warnings ·
          {results.filter((r) => r.status === "ok").length} ok
        </Text>
      }
    />
  )
}
