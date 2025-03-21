import path from "node:path"
import { pathToFileURL } from "node:url"
import z from "zod"
import { LSP } from "../lsp"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { assertExternalDirectory } from "./external-directory"
import DESCRIPTION from "./lsp.txt"
import { Tool } from "./tool"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
  "codeAction",
  "diagnostics",
] as const

export const LspTool = Tool.define("lsp", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum(operations).describe("The LSP operation to perform"),
    filePath: z.string().describe("The absolute or relative path to the file"),
    line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The line number (1-based). Required for position-based operations."),
    character: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("The character offset (1-based). Required for position-based operations."),
  }),
  execute: async (args, ctx) => {
    const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(Instance.directory, args.filePath)
    await assertExternalDirectory(ctx, file)

    await ctx.ask({
      permission: "lsp",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })
    const uri = pathToFileURL(file).href
    const needs = !["diagnostics", "documentSymbol", "workspaceSymbol"].includes(args.operation)
    if (needs && (args.line === undefined || args.character === undefined))
      throw new Error(`${args.operation} requires line and character parameters`)
    const position = {
      file,
      line: (args.line ?? 1) - 1,
      character: (args.character ?? 1) - 1,
    }

    const relPath = path.relative(Instance.worktree, file)
    const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

    const exists = await Filesystem.exists(file)
    if (!exists) {
      throw new Error(`File not found: ${file}`)
    }

    const available = await LSP.hasClients(file)
    if (!available) {
      throw new Error("No LSP server available for this file type.")
    }

    await LSP.touchFile(file, true)

    const result: unknown[] = await (async () => {
      switch (args.operation) {
        case "goToDefinition":
          return LSP.definition(position)
        case "findReferences":
          return LSP.references(position)
        case "hover":
          return LSP.hover(position)
        case "documentSymbol":
          return LSP.documentSymbol(uri)
        case "workspaceSymbol":
          return LSP.workspaceSymbol("")
        case "goToImplementation":
          return LSP.implementation(position)
        case "prepareCallHierarchy":
          return LSP.prepareCallHierarchy(position)
        case "incomingCalls":
          return LSP.incomingCalls(position)
        case "outgoingCalls":
          return LSP.outgoingCalls(position)
        case "codeAction":
          return LSP.codeAction(position)
        case "diagnostics":
          return LSP.fileDiagnostics(file)
      }
    })()

    const output = (() => {
      if (result.length === 0) return `No results found for ${args.operation}`
      return JSON.stringify(result, null, 2)
    })()

    return {
      title,
      metadata: { result },
      output,
    }
  },
})
