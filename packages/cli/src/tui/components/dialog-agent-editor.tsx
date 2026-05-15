import { Box, type Color, Text } from "@liteai/ink"
import type { Agent } from "@liteai/sdk"
import { useState } from "react"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useToast } from "../context/toast"
import { useRegisterKeybindingContext } from "../keybindings/keybinding-context"
import { useKeybindings } from "../keybindings/use-keybinding"
import { TextInput } from "./text-input"

export function DialogAgentEditor({
  agent,
  onBack,
  onClose,
}: {
  agent?: Agent
  onBack?: () => void
  onClose?: () => void
}) {
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const isNew = !agent

  const [form, setForm] = useState({
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    prompt: agent?.prompt ?? "",
    mode: agent?.mode ?? "all",
    model: typeof agent?.model === "string" ? agent.model : ((agent?.model as { modelID?: string })?.modelID ?? ""),
  })

  useRegisterKeybindingContext("Confirmation")

  const fields = isNew
    ? (["name", "description", "prompt", "model"] as const)
    : (["description", "prompt", "model"] as const)
  const [focusIndex, setFocusIndex] = useState(0)

  useKeybindings(
    {
      "confirm:next": () => setFocusIndex((i) => (i + 1) % fields.length),
      "confirm:nextField": () => setFocusIndex((i) => (i + 1) % fields.length),
      "confirm:previous": () => setFocusIndex((i) => (i - 1 + fields.length) % fields.length),
      "confirm:no": () => onBack?.(),
      "confirm:yes": save,
    },
    { context: "Confirmation" },
  )

  async function save() {
    if (isNew && !form.name) {
      toast.show({ variant: "error", message: "Name is required" })
      return
    }

    const payload = {
      ...form,
      model: form.model || undefined,
    }

    try {
      if (isNew) {
        await sdk.client.project.agent.create({ projectID: sdk.projectID, ...payload } as Parameters<
          typeof sdk.client.project.agent.create
        >[0])
      } else {
        await sdk.client.project.agent.update({
          projectID: sdk.projectID,
          ...payload,
        } as Parameters<typeof sdk.client.project.agent.update>[0])
      }
      toast.show({ variant: "success", message: `Agent ${isNew ? "created" : "updated"}` })
      onClose?.()
    } catch (err: unknown) {
      toast.show({ variant: "error", message: (err as Error).message || "Failed to save agent" })
    }
  }

  const focusedField = fields[focusIndex]

  function LabelInput({
    label,
    fieldName,
    placeholder,
  }: {
    label: string
    fieldName: keyof typeof form
    placeholder?: string
  }) {
    const isFocused = focusedField === fieldName
    return (
      <Box flexDirection="row" gap={2}>
        <Box width={15}>
          <Text color={(isFocused ? theme.primary : theme.textMuted) as Color}>{label}</Text>
        </Box>
        <Box flexGrow={1} borderStyle="round" borderColor={isFocused ? "ansi:blue" : "ansi:black"} paddingX={1}>
          <TextInput
            value={form[fieldName]}
            onChange={(v) => setForm({ ...form, [fieldName]: v })}
            focus={isFocused}
            placeholder={placeholder}
            onSubmit={save}
            onTab={() => setFocusIndex((i) => (i + 1) % fields.length)}
          />
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1} paddingBottom={1} paddingLeft={4} paddingRight={4}>
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text color={theme.text as Color} bold>
          {isNew ? "Create Agent" : "Edit Agent"}
        </Text>
        <Text color={theme.textMuted as Color}>esc cancel</Text>
      </Box>

      <Box flexDirection="column" gap={1} borderStyle="round" borderColor="ansi:blue" paddingX={2} paddingY={1}>
        {isNew && <LabelInput label="Name" fieldName="name" placeholder="Agent ID (e.g. review-bot)" />}
        <LabelInput label="Description" fieldName="description" placeholder="What does this agent do?" />
        <LabelInput label="Model" fieldName="model" placeholder="Model ID (e.g. claude-3-5-sonnet-latest)" />
        <LabelInput label="Prompt" fieldName="prompt" placeholder="System prompt instructions" />
      </Box>

      <Box flexDirection="row" gap={2} marginTop={1}>
        <Text color={theme.textMuted as Color}>Up/Down/Tab navigate</Text>
        <Text color={theme.textMuted as Color}>Enter save</Text>
      </Box>
    </Box>
  )
}
