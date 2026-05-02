import type { Part, ToolPart } from "@liteai/sdk"
import { isCompactEligible } from "../constants/compact-allowlist"

export interface ToolGroupPart {
  type: "tool-group"
  id: string
  tools: ToolPart[]
}

export type UILocalPart = Part | ToolGroupPart

/**
 * Groups consecutive compactable tools into a single ToolGroupPart.
 * Excludes tools that are not eligible for compaction.
 */
export function collapseToolParts(parts: Part[]): UILocalPart[] {
  const result: UILocalPart[] = []
  let currentGroup: ToolPart[] = []

  for (const part of parts) {
    if (part.type === "tool" && isCompactEligible(part.tool)) {
      currentGroup.push(part as ToolPart)
    } else {
      const first = currentGroup[0]
      if (currentGroup.length === 1 && first) {
        result.push(first)
      } else if (first) {
        result.push({
          type: "tool-group",
          id: `group-${first.id}`,
          tools: currentGroup,
        })
      }
      currentGroup = []
      result.push(part)
    }
  }

  const first = currentGroup[0]
  if (currentGroup.length === 1 && first) {
    result.push(first)
  } else if (first) {
    result.push({
      type: "tool-group",
      id: `group-${first.id}`,
      tools: currentGroup,
    })
  }

  return result
}
