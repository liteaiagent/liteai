import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { NamedError } from "@liteai/util/error"
import { PermissionNext } from "@/permission/next"
import type { Tool } from "@/tool/tool"
import { decodeDataUrl } from "@/util/data-url"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { ConfigMarkdown } from "../../config/markdown"
import { FileTime } from "../../file/time"
import { Hook } from "../../hook"
import { LSP } from "../../lsp"
import { MCP } from "../../mcp"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ReadTool } from "../../tool/read"
import { defer } from "../../util/defer"
import { Filesystem } from "../../util/filesystem"
import { Log } from "../../util/log"
import { Session } from ".."
import { InstructionPrompt } from "../instruction"
import type { Message } from "../message"
import { MessageID, PartID, type SessionID } from "../schema"
import type { PromptInput } from "./loop"
import { lastModel } from "./loop"

const log = Log.create({ service: "session.prompt.message" })

export async function resolvePromptParts(template: string): Promise<PromptInput["parts"]> {
  const parts: PromptInput["parts"] = [
    {
      type: "text",
      text: template,
    },
  ]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  await Promise.all(
    files.map(async (match) => {
      const name = match[1]
      if (seen.has(name)) return
      seen.add(name)
      const filepath = name.startsWith("~/")
        ? path.join(os.homedir(), name.slice(2))
        : path.resolve(Instance.worktree, name)

      const stats = await import("node:fs/promises").then((fs) => fs.stat(filepath).catch(() => undefined))
      if (!stats) {
        const agent = await Agent.get(name)
        if (agent) {
          parts.push({
            type: "agent",
            name: agent.name,
          })
        }
        return
      }

      if (stats.isDirectory()) {
        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "application/x-directory",
        })
        return
      }

      parts.push({
        type: "file",
        url: pathToFileURL(filepath).href,
        filename: name,
        mime: "text/plain",
      })
    }),
  )
  return parts
}

type Draft<T> = T extends Message.Part ? Omit<T, "id"> & { id?: string } : never

// The input file part type from PromptInput (without sessionID/messageID, optional id)
type InputFilePart = {
  id?: string
  type: "file"
  mime: string
  filename?: string
  url: string
  source?: Message.FilePart["source"]
}

export async function createUserMessage(input: PromptInput) {
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))

  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  if (!model) throw new Error("no model available: connect a provider first")
  const full =
    !input.variant && agent.variant
      ? await Provider.getModel(model.providerID, model.modelID).catch(() => undefined)
      : undefined
  const variant = input.variant ?? (agent.variant && full?.variants?.[agent.variant] ? agent.variant : undefined)

  const info: Message.User = {
    id: input.messageID ?? MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    agent: agent.name,
    model,
    system: input.system,
    format: input.format,
    variant,
  }
  using _ = defer(() => InstructionPrompt.clear(info.id))

  const assign = (part: Draft<Message.Part>): Message.Part => ({
    ...part,
    id: part.id ? PartID.make(part.id) : PartID.ascending(),
  })

  const parts = await Promise.all(
    input.parts.map(async (part): Promise<Draft<Message.Part>[]> => {
      if (part.type === "file") {
        // before checking the protocol we check if this is an mcp resource because it needs special handling
        if (part.source?.type === "resource") {
          return handleMcpResource(part as InputFilePart, info, input.sessionID)
        }
        const url = new URL(part.url)
        switch (url.protocol) {
          case "data:":
            if (part.mime === "text/plain") {
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: decodeDataUrl(part.url),
                },
                {
                  ...part,
                  messageID: info.id,
                  sessionID: input.sessionID,
                },
              ]
            }
            break
          case "file:": {
            return handleFilePart(part as InputFilePart, url, info, input.sessionID, agent)
          }
        }
      }

      if (part.type === "agent") {
        // Check if this agent would be denied by task permission
        const perm = PermissionNext.evaluate("task", part.name, agent.permission)
        const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
        return [
          {
            ...part,
            messageID: info.id,
            sessionID: input.sessionID,
          },
          {
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            // An extra space is added here. Otherwise the 'Use' gets appended
            // to user's last word; making a combined word
            text:
              " Use the above message and context to generate a prompt and call the task tool with subagent: " +
              part.name +
              hint,
          },
        ]
      }

      return [
        {
          ...part,
          messageID: info.id,
          sessionID: input.sessionID,
        },
      ]
    }),
  ).then((x) => x.flat().map(assign))

  await Hook.dispatch("UserPromptSubmit", {
    session_id: input.sessionID,
    cwd: process.cwd(),
    hook_event_name: "UserPromptSubmit",
    prompt: parts.find((p) => p.type === "text")?.text,
  })

  await Plugin.trigger(
    "chat.message",
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      messageID: input.messageID,
      variant: input.variant,
    },
    {
      message: info,
      parts,
    },
  )

  await Session.updateMessage(info)
  for (const part of parts) {
    await Session.updatePart(part)
  }

  return {
    info,
    parts,
  }
}

async function handleMcpResource(
  part: InputFilePart,
  info: Message.User,
  sessionID: SessionID,
): Promise<Draft<Message.Part>[]> {
  const { clientName, uri } = part.source as { type: "resource"; clientName: string; uri: string }
  log.info("mcp resource", { clientName, uri, mime: part.mime })

  const pieces: Draft<Message.Part>[] = [
    {
      messageID: info.id,
      sessionID,
      type: "text",
      synthetic: true,
      text: `Reading MCP resource: ${part.filename} (${uri})`,
    },
  ]

  try {
    const resourceContent = await MCP.readResource(clientName, uri)
    if (!resourceContent) {
      throw new Error(`Resource not found: ${clientName}/${uri}`)
    }

    // Handle different content types
    const contents = Array.isArray(resourceContent.contents) ? resourceContent.contents : [resourceContent.contents]

    for (const content of contents) {
      if ("text" in content && content.text) {
        pieces.push({
          messageID: info.id,
          sessionID,
          type: "text",
          synthetic: true,
          text: content.text as string,
        })
      } else if ("blob" in content && content.blob) {
        // Handle binary content if needed
        const mimeType = "mimeType" in content ? content.mimeType : part.mime
        pieces.push({
          messageID: info.id,
          sessionID,
          type: "text",
          synthetic: true,
          text: `[Binary content: ${mimeType}]`,
        })
      }
    }

    pieces.push({
      ...part,
      messageID: info.id,
      sessionID,
    })
  } catch (error: unknown) {
    log.error("failed to read MCP resource", { error, clientName, uri })
    const message = error instanceof Error ? error.message : String(error)
    pieces.push({
      messageID: info.id,
      sessionID,
      type: "text",
      synthetic: true,
      text: `Failed to read MCP resource ${part.filename}: ${message}`,
    })
  }

  return pieces
}

async function handleFilePart(
  part: InputFilePart,
  url: URL,
  info: Message.User,
  sessionID: SessionID,
  agent: Agent.Info,
): Promise<Draft<Message.Part>[]> {
  log.info("file", { mime: part.mime })
  // have to normalize, symbol search returns absolute paths
  // Decode the pathname since URL constructor doesn't automatically decode it
  const filepath = fileURLToPath(part.url)
  const s = Filesystem.stat(filepath)

  if (s?.isDirectory()) {
    part.mime = "application/x-directory"
  }

  if (part.mime === "text/plain") {
    return handleTextFile(part, url, filepath, info, sessionID, agent)
  }

  if (part.mime === "application/x-directory") {
    const args = { filePath: filepath }
    const ctx: Tool.Context = {
      sessionID,
      abort: new AbortController().signal,
      agent: agent.name,
      messageID: info.id,
      extra: { bypassCwdCheck: true },
      messages: [],
      metadata: async () => {},
      ask: async () => {},
    }
    const result = await ReadTool.init().then((t) => t.execute(args, ctx))
    return [
      {
        messageID: info.id,
        sessionID,
        type: "text",
        synthetic: true,
        text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
      },
      {
        messageID: info.id,
        sessionID,
        type: "text",
        synthetic: true,
        text: result.output,
      },
      {
        ...part,
        messageID: info.id,
        sessionID,
      },
    ]
  }

  FileTime.read(sessionID, filepath)
  return [
    {
      messageID: info.id,
      sessionID,
      type: "text",
      text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
      synthetic: true,
    },
    {
      id: part.id,
      messageID: info.id,
      sessionID,
      type: "file",
      url: `data:${part.mime};base64,${(await Filesystem.readBytes(filepath)).toString("base64")}`,
      mime: part.mime,
      filename: part.filename ?? "",
      source: part.source,
    },
  ]
}

async function handleTextFile(
  part: InputFilePart,
  url: URL,
  filepath: string,
  info: Message.User,
  sessionID: SessionID,
  agent: Agent.Info,
): Promise<Draft<Message.Part>[]> {
  let offset: number | undefined
  let limit: number | undefined
  const range = {
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
  }
  if (range.start != null) {
    const filePathURI = part.url.split("?")[0]
    let start = parseInt(range.start, 10)
    let end = range.end ? parseInt(range.end, 10) : undefined
    // some LSP servers (eg, gopls) don't give full range in
    // workspace/symbol searches, so we'll try to find the
    // symbol in the document to get the full range
    if (start === end) {
      const symbols = await LSP.documentSymbol(filePathURI).catch(() => [])
      for (const symbol of symbols) {
        let range: LSP.Range | undefined
        if ("range" in symbol) {
          range = symbol.range
        } else if ("location" in symbol) {
          range = symbol.location.range
        }
        if (range?.start?.line && range?.start?.line === start) {
          start = range.start.line
          end = range?.end?.line ?? start
          break
        }
      }
    }
    offset = Math.max(start, 1)
    if (end) {
      limit = end - (offset - 1)
    }
  }
  const args = { filePath: filepath, offset, limit }

  const pieces: Draft<Message.Part>[] = [
    {
      messageID: info.id,
      sessionID,
      type: "text",
      synthetic: true,
      text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
    },
  ]

  await ReadTool.init()
    .then(async (t) => {
      const model = await Provider.getModel(info.model.providerID, info.model.modelID)
      const ctx: Tool.Context = {
        sessionID,
        abort: new AbortController().signal,
        agent: agent.name,
        messageID: info.id,
        extra: { bypassCwdCheck: true, model },
        messages: [],
        metadata: async () => {},
        ask: async () => {},
      }
      const result = await t.execute(args, ctx)
      pieces.push({
        messageID: info.id,
        sessionID,
        type: "text",
        synthetic: true,
        text: result.output,
      })
      if (result.attachments?.length) {
        pieces.push(
          ...result.attachments.map(
            (attachment) =>
              ({
                ...attachment,
                synthetic: true,
                filename: attachment.filename ?? part.filename,
                messageID: info.id,
                sessionID,
              }) as Draft<Message.Part>,
          ),
        )
      } else {
        pieces.push({
          ...part,
          messageID: info.id,
          sessionID,
        })
      }
    })
    .catch((error) => {
      log.error("failed to read file", { error })
      const message = error instanceof Error ? error.message : error.toString()
      Bus.publish(Session.Event.Error, {
        sessionID,
        error: new NamedError.Unknown({
          message,
        }).toObject(),
      })
      pieces.push({
        messageID: info.id,
        sessionID,
        type: "text",
        synthetic: true,
        text: `Read tool failed to read ${filepath} with the following error: ${message}`,
      })
    })

  return pieces
}
