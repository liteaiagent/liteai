/**
 * PromptController — abstract interface for prompt state management.
 *
 * Note: `packages/ui/src/panes/shared/prompt.tsx` is already platform-agnostic
 * (it only depends on `pane-route` + `persist`). This interface exists for
 * completeness and to enable future overrides, but the default PromptProvider
 * is suitable for all platforms.
 */

// Re-export the prompt types so controllers/index.ts has a single import point
export type {
  AgentPart,
  ContentPart,
  ContextItem,
  FileAttachmentPart,
  FileContextItem,
  FileSelection,
  ImageAttachmentPart,
  Prompt,
  TextPart,
} from "../shared/prompt"
