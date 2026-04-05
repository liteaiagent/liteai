import { createHash } from "node:crypto"
import type { Attributes } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import { isTelemetryEnabled } from "./instrumentation"

const MAX_CONTENT_SIZE = 60 * 1024 // 60KB

const seenHashes = new Set<string>()
let eventSequence = 0

export function clearEventTrackingState(): void {
  seenHashes.clear()
}

export function truncateContent(
  content: string,
  maxSize: number = MAX_CONTENT_SIZE,
): { content: string; truncated: boolean } {
  if (content.length <= maxSize) {
    return { content, truncated: false }
  }
  return {
    content: `${content.slice(0, maxSize)}\n\n[TRUNCATED - Content exceeds limit]`,
    truncated: true,
  }
}

export function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}

export function logOTelEvent(eventName: string, metadata: Record<string, string | number | boolean> = {}): void {
  if (!isTelemetryEnabled()) return

  // We rely on the global logger provider configured in instrumentation.ts
  const eventLogger = logs.getLogger("com.liteai.events", "1.0.0")

  const attributes: Attributes = {
    "event.name": eventName,
    "event.timestamp": new Date().toISOString(),
    "event.sequence": eventSequence++,
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      attributes[key] = value
    }
  }

  eventLogger.emit({
    body: `liteai.${eventName}`,
    attributes,
  })
}

export function logSystemPromptIfNeeded(systemPrompt: string): void {
  if (!isTelemetryEnabled()) return

  const promptHash = `sp_${shortHash(systemPrompt)}`

  if (!seenHashes.has(promptHash)) {
    seenHashes.add(promptHash)

    const { content: truncatedPrompt, truncated } = truncateContent(systemPrompt)

    logOTelEvent("system_prompt", {
      system_prompt_hash: promptHash,
      system_prompt: truncatedPrompt,
      system_prompt_length: systemPrompt.length,
      ...(truncated && { system_prompt_truncated: true }),
    })
  }
}

export function logToolSchemaIfNeeded(toolName: string, toolSchemaJson: string): void {
  if (!isTelemetryEnabled()) return

  const toolHash = shortHash(toolSchemaJson)
  const cacheKey = `tool_${toolHash}`

  if (!seenHashes.has(cacheKey)) {
    seenHashes.add(cacheKey)

    const { content: truncatedTool, truncated } = truncateContent(toolSchemaJson)

    logOTelEvent("tool", {
      tool_name: toolName,
      tool_hash: toolHash,
      tool: truncatedTool,
      ...(truncated && { tool_truncated: true }),
    })
  }
}
