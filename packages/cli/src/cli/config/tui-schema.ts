import z from "zod"
import { KEYBINDING_CONTEXTS, type KeybindingContextName } from "../../tui/keybindings/types"

export const KeybindingOverrides = z
  .array(
    z.object({
      context: z.enum(KEYBINDING_CONTEXTS as unknown as [KeybindingContextName, ...KeybindingContextName[]]),
      bindings: z.record(z.string(), z.string().nullable()),
    }),
  )
  .optional()

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  errorVerbosity: z
    .enum(["low", "full"])
    .optional()
    .describe("Control error verbosity: 'low' shows only the first line, 'full' shows the full stack trace"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindingOverrides,
  })
  .extend(TuiOptions.shape)
  .strict()
