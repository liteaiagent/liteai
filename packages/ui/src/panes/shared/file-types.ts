export type SelectedLineRange = {
  start: number
  end: number
  side?: "additions" | "deletions"
  endSide?: "additions" | "deletions"
}

export function selectionFromLines(range: SelectedLineRange) {
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)
  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}
