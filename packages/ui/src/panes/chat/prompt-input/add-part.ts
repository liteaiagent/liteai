/**
 * Add Part at Cursor — inserts a text, file, or agent part into
 * a contenteditable editor at the current selection point.
 *
 * Extracted from web's PromptInput (Phase 2c of the refactor plan).
 * Pure DOM function — no framework or web-SDK dependencies.
 */

import type { ContentPart, Prompt } from "../../shared/prompt"
import { createTextFragment, getCursorPosition, setCursorPosition, setRangeEdge } from "./editor-dom"
import { createPill } from "./editor-reconciler"
import { promptLength } from "./history"

export interface AddPartContext {
  /** The contenteditable editor element. */
  editorRef: HTMLDivElement
  /** Current prompt model. */
  currentPrompt: () => Prompt
  /** Current cursor position (from prompt state). */
  cursor: () => number | undefined
  /** Called after the part is inserted to process the resulting input. */
  handleInput: () => void
  /** Called after the part is inserted to close any open popovers. */
  closePopover: () => void
}

/**
 * Insert a non-image content part at the current cursor position.
 *
 * For file/agent parts: replaces any `@query` preceding the cursor
 * with a pill element, then inserts a trailing space.
 *
 * For text parts: inserts the text as a document fragment, handling
 * trailing `<br>` + ZWS sentinel edge cases.
 *
 * @returns `true` if the part was inserted, `false` if it could not
 *   be placed (e.g. no valid selection).
 */
export function addPartAtCursor(part: ContentPart, ctx: AddPartContext): boolean {
  if (part.type === "image") return false

  const { editorRef, currentPrompt, cursor, handleInput, closePopover } = ctx
  const selection = window.getSelection()
  if (!selection) return false

  if (selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) {
    editorRef.focus()
    const pos = cursor() ?? promptLength(currentPrompt())
    setCursorPosition(editorRef, pos)
  }

  if (selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (!editorRef.contains(range.startContainer)) return false

  if (part.type === "file" || part.type === "agent") {
    const cursorPosition = getCursorPosition(editorRef)
    const rawText = currentPrompt()
      .map((p) => ("content" in p ? p.content : ""))
      .join("")
    const textBeforeCursor = rawText.substring(0, cursorPosition)
    const atMatch = textBeforeCursor.match(/@(\S*)$/)
    const pill = createPill(part)
    const gap = document.createTextNode(" ")

    if (atMatch) {
      const start = atMatch.index ?? cursorPosition - atMatch[0].length
      setRangeEdge(editorRef, range, "start", start)
      setRangeEdge(editorRef, range, "end", cursorPosition)
    }

    range.deleteContents()
    range.insertNode(gap)
    range.insertNode(pill)
    range.setStartAfter(gap)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  if (part.type === "text") {
    const fragment = createTextFragment(part.content)
    const last = fragment.lastChild
    range.deleteContents()
    range.insertNode(fragment)
    if (last) {
      if (last.nodeType === Node.TEXT_NODE) {
        const text = last.textContent ?? ""
        if (text === "\u200B") {
          range.setStart(last, 0)
        }
        if (text !== "\u200B") {
          range.setStart(last, text.length)
        }
      }
      if (last.nodeType !== Node.TEXT_NODE) {
        const isBreak = last.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR"
        const next = last.nextSibling
        const emptyText = next?.nodeType === Node.TEXT_NODE && (next.textContent ?? "") === ""
        if (isBreak && (!next || emptyText)) {
          const placeholder = next && emptyText ? next : document.createTextNode("\u200B")
          if (!next) last.parentNode?.insertBefore(placeholder, null)
          placeholder.textContent = "\u200B"
          range.setStart(placeholder, 0)
        } else {
          range.setStartAfter(last)
        }
      }
    }
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  handleInput()
  closePopover()
  return true
}
