export type SuggestionType = "none" | "file" | "directory" | "command" | "agent" | "slack-channel" | "custom-title"

export type SuggestionItem = {
  id: string
  displayText: string
  tag?: string
  description?: string
  metadata?: unknown
}
