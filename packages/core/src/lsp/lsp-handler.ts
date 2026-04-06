import { generateText } from "ai"
import {
  createConnection,
  type InlineCompletionItem,
  type InlineCompletionList,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node"
import { TextDocument } from "vscode-languageserver-textdocument"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { LANGUAGE_EXTENSIONS } from "./language"

const log = Log.create({ service: "lsp.handler" })

/**
 * Builds a concise code-completion prompt from the document and cursor position.
 * We pass the text before (prefix) and after (suffix) the cursor to give the
 * model fill-in-the-middle context.
 */
export function buildCompletionPrompt(params: {
  prefix: string
  suffix: string
  languageId: string
  fileUri: string
}): string {
  const { prefix, suffix, languageId, fileUri } = params
  // Keep context window small for latency — last 100 lines of prefix, first 20 of suffix
  const prefixLines = prefix.split("\n")
  const suffixLines = suffix.split("\n")
  const trimmedPrefix = prefixLines.slice(-100).join("\n")
  const trimmedSuffix = suffixLines.slice(0, 20).join("\n")

  return [
    `You are a code completion engine. Complete the code at the cursor position.`,
    `Language: ${languageId}`,
    `File: ${fileUri}`,
    ``,
    `<prefix>`,
    trimmedPrefix,
    `</prefix>`,
    `<suffix>`,
    trimmedSuffix,
    `</suffix>`,
    ``,
    `Output ONLY the completion text to insert at the cursor. No explanation, no markdown fences, no surrounding context.`,
    `The completion should be concise (1-5 lines). If nothing useful can be added at this position, output an empty string.`,
  ].join("\n")
}

/**
 * Resolve the best available small model for completions.
 * Uses Provider.getSmallModel() which respects the user's small_model config
 * and falls back to the best known fast model per provider (Haiku, Flash, etc.)
 */
async function resolveCompletionModel() {
  try {
    const defaultRef = await Provider.defaultModel()
    if (!defaultRef) {
      log.warn("no default model configured — inline completions unavailable")
      return undefined
    }
    const small = await Provider.getSmallModel(defaultRef.providerID)
    if (small) {
      log.info("resolved completion model", { providerID: small.providerID, modelID: small.id })
      return small
    }
    // Fallback: use the default model itself (suboptimal for latency but functional)
    const fallback = await Provider.getModel(defaultRef.providerID, defaultRef.modelID)
    log.info("no small model found, using default model for completions", {
      providerID: fallback.providerID,
      modelID: fallback.id,
    })
    return fallback
  } catch (err) {
    log.error("failed to resolve completion model", { error: err })
    return undefined
  }
}

/**
 * Start the LSP server on stdin/stdout.
 *
 * This runs alongside the existing Hono HTTP server. The two transports
 * are completely independent — HTTP handles chat/API, LSP handles editor features.
 *
 * Since stdout is now used for LSP JSON-RPC framing, all log output (including
 * the "listening on..." startup line) must go to stderr. main.ts handles this
 * redirect before calling startLSPHandler().
 */
export function startLSPHandler() {
  log.info("initializing LSP handler on stdio")

  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
  const documents = new TextDocuments(TextDocument)

  // ─── Capabilities ──────────────────────────────────────────────────────────
  connection.onInitialize(() => {
    log.info("LSP client connected")
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        // Advertise inline completion support (VSP proposed feature)
        inlineCompletionProvider: {},
      },
    }
  })

  connection.onInitialized(() => {
    log.info("LSP initialized")
  })

  // ─── Inline completions ────────────────────────────────────────────────────
  connection.languages.inlineCompletion.on(async (params) => {
    const { textDocument, position } = params

    const doc = documents.get(textDocument.uri)
    if (!doc) {
      log.debug("inline completion: document not found", { uri: textDocument.uri })
      return null
    }

    // Get text before and after cursor
    const fullText = doc.getText()
    const offset = doc.offsetAt(position)
    const prefix = fullText.slice(0, offset)
    const suffix = fullText.slice(offset)

    // Skip completion if the prefix is very short (< 3 chars of content) or
    // if we're in a comment/string that ends with whitespace — low signal
    const currentLine = prefix.split("\n").at(-1) ?? ""
    if (currentLine.trimEnd().length < 2) {
      return null
    }

    const model = await resolveCompletionModel()
    if (!model) return null

    try {
      const language = await Provider.getLanguage(model)

      // Determine language ID for the prompt
      const ext = `.${doc.uri.split(".").at(-1) ?? ""}`
      const languageId = LANGUAGE_EXTENSIONS[ext] ?? doc.languageId ?? "plaintext"

      const prompt = buildCompletionPrompt({
        prefix,
        suffix,
        languageId,
        fileUri: doc.uri,
      })

      log.debug("requesting inline completion", {
        uri: textDocument.uri,
        line: position.line,
        character: position.character,
        modelID: model.id,
      })

      const result = await generateText({
        model: language,
        prompt,
        maxOutputTokens: 256,
        temperature: 0,
        abortSignal: AbortSignal.timeout(8_000),
        experimental_telemetry: { isEnabled: true, functionId: "lsp.inline-completion" },
      })

      const text = result.text.trim()
      if (!text) return null

      log.debug("inline completion result", { length: text.length })

      const item: InlineCompletionItem = {
        insertText: text,
        range: {
          start: position,
          end: position,
        },
      }

      return { items: [item] } satisfies InlineCompletionList
    } catch (err) {
      // Swallow errors — completions are best-effort, never crash the LSP connection
      if (err instanceof Error && err.name === "AbortError") {
        log.debug("inline completion timed out")
      } else {
        log.error("inline completion error", { error: err })
      }
      return null
    }
  })

  // ─── Wire up document sync and start ───────────────────────────────────────
  documents.listen(connection)
  connection.listen()

  log.info("LSP handler listening on stdio")
}
