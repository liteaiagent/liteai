import type { StructuredPatchHunk } from "diff"

export type DiffLineInfo = {
  text: string
  type: "add" | "remove" | "nochange"
  oldNum: number | null
  newNum: number | null
}

export function generateDiffLines(patch: StructuredPatchHunk): DiffLineInfo[] {
  let oldNum = patch.oldStart
  let newNum = patch.newStart

  return patch.lines.map((line) => {
    let type: "add" | "remove" | "nochange" = "nochange"
    let oNum: number | null = null
    let nNum: number | null = null

    if (line.startsWith("+")) {
      type = "add"
      nNum = newNum++
    } else if (line.startsWith("-")) {
      type = "remove"
      oNum = oldNum++
    } else {
      type = "nochange"
      oNum = oldNum++
      nNum = newNum++
    }

    return {
      text: line.slice(1),
      type,
      oldNum: oNum,
      newNum: nNum,
    }
  })
}
