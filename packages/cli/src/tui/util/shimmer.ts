import { stringWidth } from "@liteai/ink"

export const SHIMMER_INTERVAL_MS = 150

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Split text into {before, shimmer, after} by visual column for highlight sweep */
export function computeShimmerSegments(
  text: string,
  glimmerIndex: number,
): { before: string; shimmer: string; after: string } {
  const segments = Array.from(segmenter.segment(text))
  const messageWidth = stringWidth(text)

  if (glimmerIndex < 0 || glimmerIndex > messageWidth) {
    return { before: text, shimmer: "", after: "" }
  }

  let before = ""
  let shimmer = ""
  let after = ""
  let currentWidth = 0

  for (const { segment } of segments) {
    const segWidth = stringWidth(segment)

    if (currentWidth < glimmerIndex) {
      before += segment
    } else if (currentWidth < glimmerIndex + 3) {
      shimmer += segment
    } else {
      after += segment
    }

    currentWidth += segWidth
  }

  return { before, shimmer, after }
}

/** Reverse-sweep glimmer index: sweeps right-to-left across messageWidth */
export function computeGlimmerIndex(tick: number, messageWidth: number): number {
  // Pad with 10 ticks (10 spaces) before and after message
  const totalTicks = messageWidth + 20
  const currentTick = tick % totalTicks

  // Sweep right-to-left
  return messageWidth + 10 - currentTick
}
