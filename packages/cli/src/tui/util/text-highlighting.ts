import type { ThemeColors } from "../context/theme"

/**
 * Text highlight definition for input text rendering.
 * Used by the prompt input system for syntax highlighting,
 * search result highlighting, and visual decorations.
 */
export type TextHighlight = {
  start: number
  end: number
  color: keyof ThemeColors | undefined
  dimColor?: boolean
  inverse?: boolean
  shimmerColor?: keyof ThemeColors
  priority: number
}

/**
 * A segment of text, potentially with a highlight applied.
 * Produced by segmentTextByHighlights for rendering.
 */
export type TextSegment = {
  text: string
  start: number
  highlight?: TextHighlight
}

/**
 * Segments text into highlighted and non-highlighted regions.
 * Handles overlapping highlights by respecting priority ordering.
 *
 * This is a simplified version that does not depend on ansi-tokenize.
 * Instead, it segments based on character positions in the raw text.
 */
export function segmentTextByHighlights(text: string, highlights: TextHighlight[]): TextSegment[] {
  if (highlights.length === 0) {
    return [{ text, start: 0 }]
  }

  const sortedHighlights = [...highlights].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return b.priority - a.priority
  })

  const resolvedHighlights: TextHighlight[] = []
  const usedRanges: Array<{ start: number; end: number }> = []

  for (const highlight of sortedHighlights) {
    if (highlight.start === highlight.end) continue

    const overlaps = usedRanges.some(
      (range) =>
        (highlight.start >= range.start && highlight.start < range.end) ||
        (highlight.end > range.start && highlight.end <= range.end) ||
        (highlight.start <= range.start && highlight.end >= range.end),
    )

    if (!overlaps) {
      resolvedHighlights.push(highlight)
      usedRanges.push({ start: highlight.start, end: highlight.end })
    }
  }

  // Build segments from resolved highlights
  const segments: TextSegment[] = []
  let currentPos = 0

  for (const highlight of resolvedHighlights.sort((a, b) => a.start - b.start)) {
    // Add unhighlighted text before this highlight
    if (highlight.start > currentPos) {
      segments.push({
        text: text.slice(currentPos, highlight.start),
        start: currentPos,
      })
    }

    // Add highlighted text
    segments.push({
      text: text.slice(highlight.start, highlight.end),
      start: highlight.start,
      highlight,
    })

    currentPos = highlight.end
  }

  // Add remaining unhighlighted text
  if (currentPos < text.length) {
    segments.push({
      text: text.slice(currentPos),
      start: currentPos,
    })
  }

  return segments
}
