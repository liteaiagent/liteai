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
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  errorVerbosity: z
    .enum(["low", "full"])
    .optional()
    .describe("Control error verbosity: 'low' shows only the first line, 'full' shows the full stack trace"),
  output_file_threshold: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe("Character count above which tool output is saved to a file instead of rendered inline (default: 5000)"),
  alternate_screen: z
    .boolean()
    .optional()
    .describe("Use alternate screen buffer (default: true). Set to false for tmux -CC or terminal recording tools"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindingOverrides,
  })
  .extend(TuiOptions.shape)
  .strict()
