/**
 * Editor Reconciler — pure DOM functions for bidirectional sync
 * between a Prompt[] model and a contenteditable div.
 *
 * Extracted from web's PromptInput (Phase 2a of the refactor plan).
 * Zero framework or web-SDK dependencies.
 */

import type { AgentPart, FileAttachmentPart, Prompt } from "../../shared/prompt"
import { DEFAULT_PROMPT, isPromptEqual } from "../../shared/prompt"
import { createTextFragment, getCursorPosition, setCursorPosition } from "./editor-dom"

// ─── Pill Creation ───

/**
 * Create a non-editable `<span>` pill for a @file or @agent mention.
 * The pill carries `data-type`, `data-path`/`data-name` attributes
 * so `parseFromDOM` can reconstruct the part.
 */
export function createPill(part: FileAttachmentPart | AgentPart): HTMLSpanElement {
  const pill = document.createElement("span")
  pill.textContent = part.content
  pill.setAttribute("data-type", part.type)
  if (part.type === "file") pill.setAttribute("data-path", part.path)
  if (part.type === "agent") pill.setAttribute("data-name", part.name)
  pill.setAttribute("contenteditable", "false")
  pill.style.userSelect = "text"
  pill.style.cursor = "default"
  return pill
}

// ─── Normalisation Check ───

/**
 * Returns `true` when the editor's child nodes are in the expected
 * normalised shape (text nodes, pills, `<br>` elements, and ZWS
 * trailing-break sentinels). When the editor is normalised we can
 * skip expensive re-renders.
 */
export function isNormalizedEditor(editorRef: HTMLDivElement): boolean {
  return Array.from(editorRef.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      if (!text.includes("\u200B")) return true
      if (text !== "\u200B") return false

      const prev = node.previousSibling
      const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
      const next = node.nextSibling
      return !!prevIsBr && !next
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    if (el.dataset.type === "file") return true
    if (el.dataset.type === "agent") return true
    return el.tagName === "BR"
  })
}

// ─── Render: Prompt[] → DOM ───

/**
 * One-way render: clears the editor and rebuilds DOM from the
 * given prompt parts (excluding images). Appends a ZWS sentinel
 * after a trailing `<br>` to keep the caret visible.
 */
export function renderEditor(editorRef: HTMLDivElement, parts: Prompt): void {
  editorRef.innerHTML = ""
  for (const part of parts) {
    if (part.type === "text") {
      editorRef.appendChild(createTextFragment(part.content))
      continue
    }
    if (part.type === "file" || part.type === "agent") {
      editorRef.appendChild(createPill(part))
    }
  }

  const last = editorRef.lastChild
  if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
    editorRef.appendChild(document.createTextNode("\u200B"))
  }
}

// ─── Parse: DOM → Prompt[] ───

/**
 * Reverse parse: walks the editor's DOM tree and reconstructs
 * a `Prompt[]` model with accurate `start`/`end` offsets.
 * Returns `DEFAULT_PROMPT` when the editor is empty.
 */
export function parseFromDOM(editorRef: HTMLDivElement): Prompt {
  const parts: Prompt = []
  let position = 0
  let buffer = ""

  const flushText = () => {
    let content = buffer
    if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
    if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
    buffer = ""
    if (!content) return
    parts.push({ type: "text", content, start: position, end: position + content.length })
    position += content.length
  }

  const pushFile = (file: HTMLElement) => {
    const content = file.textContent ?? ""
    parts.push({
      type: "file",
      path: file.dataset.path ?? "",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const pushAgent = (agent: HTMLElement) => {
    const content = agent.textContent ?? ""
    parts.push({
      type: "agent",
      name: agent.dataset.name ?? "",
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ""
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement
    if (el.dataset.type === "file") {
      flushText()
      pushFile(el)
      return
    }
    if (el.dataset.type === "agent") {
      flushText()
      pushAgent(el)
      return
    }
    if (el.tagName === "BR") {
      buffer += "\n"
      return
    }

    for (const child of Array.from(el.childNodes)) {
      visit(child)
    }
  }

  const children = Array.from(editorRef.childNodes)
  children.forEach((child, index) => {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
    visit(child)
    if (isBlock && index < children.length - 1) {
      buffer += "\n"
    }
  })

  flushText()

  if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
  return parts
}

// ─── Reconcile: bidirectional sync guard ───

/**
 * Bidirectional reconcile: given the current prompt model, decides
 * whether the editor DOM needs to be re-rendered.
 *
 * - When `mirror.input` is `true` we know the change came from the
 *   editor itself, so we only re-render if the DOM is denormalised.
 * - Otherwise we compare the DOM with the model and re-render on
 *   mismatch.
 *
 * @param input  The current prompt (images excluded).
 * @param editorRef  The contenteditable element.
 * @param mirror  A mutable `{ input: boolean }` flag shared with `handleInput`.
 */
export function reconcile(input: Prompt, editorRef: HTMLDivElement, mirror: { input: boolean }): void {
  const renderEditorWithCursor = (parts: Prompt) => {
    const cursor = currentCursor(editorRef)
    renderEditor(editorRef, parts)
    if (cursor !== null) setCursorPosition(editorRef, cursor)
  }

  if (mirror.input) {
    mirror.input = false
    if (isNormalizedEditor(editorRef)) return

    renderEditorWithCursor(input)
    return
  }

  const dom = parseFromDOM(editorRef)
  if (isNormalizedEditor(editorRef) && isPromptEqual(input, dom)) return

  renderEditorWithCursor(input)
}

// ─── Helpers ───

function currentCursor(editorRef: HTMLDivElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !editorRef.contains(selection.anchorNode)) return null
  return getCursorPosition(editorRef)
}
