import { pathToFileURL } from "node:url"
import type { AgentSideConnection, PermissionOption, PlanEntry, ToolCallContent } from "@agentclientprotocol/sdk"
import type { Event, LiteaiClient, ProjectSessionMessageResponse, ToolPart } from "@liteai/sdk"
import { z } from "zod"
import { Bus } from "../bus"
import { Session } from "../session"
import { Todo } from "../session/todo"
import { Filesystem } from "../util/filesystem"
import { Hash } from "../util/hash"
import { Log } from "../util/log"
import { getNewContent, toLocations, toToolKind } from "./mapper"
import type { ACPSessionManager } from "./session"

const log = Log.create({ service: "acp-event-streamer" })

export class ACPEventStreamer {
  private eventAbort = new AbortController()
  private eventStarted = false
  private bashSnapshots = new Map<string, string>()
  private toolStarts = new Set<string>()
  private permissionQueues = new Map<string, Promise<void>>()
  private busUnsubscribes: Array<() => void> = []
  private permissionOptions: PermissionOption[] = [
    { optionId: "once", kind: "allow_once", name: "Allow once" },
    { optionId: "always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ]

  constructor(
    private connection: AgentSideConnection,
    private sdk: LiteaiClient,
    private sessionManager: ACPSessionManager,
  ) {}

  public start() {
    if (this.eventStarted) return
    this.eventStarted = true

    this.busUnsubscribes.push(
      Bus.subscribe(Session.Event.PlanStateChanged, async (event) => {
        if (this.eventAbort.signal.aborted) return
        const session = this.sessionManager.tryGet(event.properties.sessionID)
        if (!session) return
        await this.connection.extNotification("plan.state_changed", event.properties).catch((error) => {
          log.error("failed to send plan.state_changed to ACP", { error })
        })
      }),
    )

    this.busUnsubscribes.push(
      Bus.subscribe(Session.Event.PlanApprovalRequested, async (event) => {
        if (this.eventAbort.signal.aborted) return
        const session = this.sessionManager.tryGet(event.properties.sessionID)
        if (!session) return
        await this.connection.extNotification("plan.approval_requested", event.properties).catch((error) => {
          log.error("failed to send plan.approval_requested to ACP", { error })
        })
      }),
    )

    this.runEventSubscription().catch((error) => {
      if (this.eventAbort.signal.aborted) return
      log.error("event subscription failed", { error })
    })
  }

  public stop() {
    this.eventAbort.abort()
    for (const unsubscribe of this.busUnsubscribes) {
      unsubscribe()
    }
    this.busUnsubscribes = []
  }

  private async runEventSubscription() {
    while (true) {
      if (this.eventAbort.signal.aborted) return
      const events = await this.sdk.event.subscribe({
        signal: this.eventAbort.signal,
      })
      for await (const event of events.stream) {
        if (this.eventAbort.signal.aborted) return
        const payload = (event as Record<string, unknown>)?.payload as Record<string, unknown> | undefined
        if (!payload) continue
        await this.handleEvent(payload as Event).catch((error) => {
          log.error("failed to handle event", { error, type: (payload as Record<string, unknown>).type })
        })
      }
    }
  }

  private async handleEvent(event: Event) {
    switch (event.type) {
      case "permission.asked": {
        const permission = event.properties
        const session = this.sessionManager.tryGet(permission.sessionID)
        if (!session) return

        const prev = this.permissionQueues.get(permission.sessionID) ?? Promise.resolve()
        const next = prev
          .then(async () => {
            const directory = session.cwd

            const res = await this.connection
              .requestPermission({
                sessionId: permission.sessionID,
                toolCall: {
                  toolCallId: permission.tool?.callID ?? permission.id,
                  status: "pending",
                  title: permission.permission,
                  rawInput: permission.metadata,
                  kind: toToolKind(permission.permission),
                  locations: toLocations(permission.permission, permission.metadata),
                },
                options: this.permissionOptions,
              })
              .catch(async (error) => {
                log.error("failed to request permission from ACP", {
                  error,
                  permissionID: permission.id,
                  sessionID: permission.sessionID,
                })
                await this.sdk.project.permission.reply({
                  requestID: permission.id,
                  reply: "reject",
                  projectID: directory,
                })
                return undefined
              })

            if (!res) return
            if (res.outcome.outcome !== "selected") {
              await this.sdk.project.permission.reply({
                requestID: permission.id,
                reply: "reject",
                projectID: directory,
              })
              return
            }

            if (res.outcome.optionId !== "reject" && permission.permission === "edit") {
              const metadata = permission.metadata || {}
              const filepath = typeof metadata.filepath === "string" ? metadata.filepath : ""
              const diff = typeof metadata.diff === "string" ? metadata.diff : ""
              const content = (await Filesystem.exists(filepath)) ? await Filesystem.readText(filepath) : ""
              const newContent = getNewContent(content, diff)

              if (newContent) {
                this.connection.writeTextFile({
                  sessionId: session.id,
                  path: filepath,
                  content: newContent,
                })
              }
            }

            await this.sdk.project.permission.reply({
              requestID: permission.id,
              reply: res.outcome.optionId as "once" | "always" | "reject",
              projectID: directory,
            })
          })
          .catch((error) => {
            log.error("failed to handle permission", { error, permissionID: permission.id })
          })
          .finally(() => {
            if (this.permissionQueues.get(permission.sessionID) === next) {
              this.permissionQueues.delete(permission.sessionID)
            }
          })
        this.permissionQueues.set(permission.sessionID, next)
        return
      }

      case "message.part.updated": {
        log.info("message part updated", { event: event.properties })
        const props = event.properties
        const part = props.part
        const session = this.sessionManager.tryGet(part.sessionID)
        if (!session) return
        const sessionId = session.id

        if (part.type === "tool") {
          await this.toolStart(sessionId, part)

          switch (part.state.status) {
            case "pending":
              this.bashSnapshots.delete(part.callID)
              return

            case "running": {
              const output = this.bashOutput(part)
              const content: ToolCallContent[] = []
              if (output) {
                const hash = Hash.fast(output)
                if (part.tool === "bash") {
                  if (this.bashSnapshots.get(part.callID) === hash) {
                    await this.connection
                      .sessionUpdate({
                        sessionId,
                        update: {
                          sessionUpdate: "tool_call_update",
                          toolCallId: part.callID,
                          status: "in_progress",
                          kind: toToolKind(part.tool),
                          title: part.tool,
                          locations: toLocations(part.tool, part.state.input),
                          rawInput: part.state.input,
                        },
                      })
                      .catch((error) => {
                        log.error("failed to send tool in_progress to ACP", { error })
                      })
                    return
                  }
                  this.bashSnapshots.set(part.callID, hash)
                }
                content.push({
                  type: "content",
                  content: {
                    type: "text",
                    text: output,
                  },
                })
              }
              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "in_progress",
                    kind: toToolKind(part.tool),
                    title: part.tool,
                    locations: toLocations(part.tool, part.state.input),
                    rawInput: part.state.input,
                    ...(content.length > 0 && { content }),
                  },
                })
                .catch((error) => {
                  log.error("failed to send tool in_progress to ACP", { error })
                })
              return
            }

            case "completed": {
              this.toolStarts.delete(part.callID)
              this.bashSnapshots.delete(part.callID)
              const kind = toToolKind(part.tool)
              const content: ToolCallContent[] = [
                {
                  type: "content",
                  content: {
                    type: "text",
                    text: part.state.output,
                  },
                },
              ]

              if (kind === "edit") {
                const input = part.state.input
                const filePath = typeof input.filePath === "string" ? input.filePath : ""
                const oldText = typeof input.oldString === "string" ? input.oldString : ""
                const newText =
                  typeof input.newString === "string"
                    ? input.newString
                    : typeof input.content === "string"
                      ? input.content
                      : ""
                content.push({
                  type: "diff",
                  path: filePath,
                  oldText,
                  newText,
                })
              }

              if (part.tool === "todowrite") {
                const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
                if (parsedTodos.success) {
                  await this.connection
                    .sessionUpdate({
                      sessionId,
                      update: {
                        sessionUpdate: "plan",
                        entries: parsedTodos.data.map((todo) => {
                          const status: PlanEntry["status"] =
                            todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                          return {
                            priority: "medium",
                            status,
                            content: todo.content,
                          }
                        }),
                      },
                    })
                    .catch((error) => {
                      log.error("failed to send session update for todo", { error })
                    })
                } else {
                  log.error("failed to parse todo output", { error: parsedTodos.error })
                }
              }

              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "completed",
                    kind,
                    content,
                    title: part.state.title,
                    rawInput: part.state.input,
                    rawOutput: {
                      output: part.state.output,
                      metadata: part.state.metadata,
                    },
                  },
                })
                .catch((error) => {
                  log.error("failed to send tool completed to ACP", { error })
                })
              return
            }
            case "error":
              this.toolStarts.delete(part.callID)
              this.bashSnapshots.delete(part.callID)
              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "failed",
                    kind: toToolKind(part.tool),
                    title: part.tool,
                    rawInput: part.state.input,
                    content: [
                      {
                        type: "content",
                        content: {
                          type: "text",
                          text: part.state.error,
                        },
                      },
                    ],
                    rawOutput: {
                      error: part.state.error,
                      metadata: part.state.metadata,
                    },
                  },
                })
                .catch((error) => {
                  log.error("failed to send tool error to ACP", { error })
                })
              return
          }
        }
        break
      }

      case "message.part.delta": {
        const props = event.properties
        const session = this.sessionManager.tryGet(props.sessionID)
        if (!session) return
        const sessionId = session.id

        const message = await this.sdk.project.session
          .message(
            {
              sessionID: props.sessionID,
              messageID: props.messageID,
              projectID: session.cwd,
            },
            { throwOnError: true },
          )
          .then((x) => x.data)
          .catch((error) => {
            log.error("unexpected error when fetching message", { error })
            return undefined
          })

        if (!message || message.info.role !== "assistant") return

        const part = message.parts.find((p) => p.id === props.partID)
        if (!part) return

        if (part.type === "text" && props.field === "text" && part.ignored !== true) {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: props.delta,
                },
              },
            })
            .catch((error) => {
              log.error("failed to send text delta to ACP", { error })
            })
          return
        }

        if (part.type === "reasoning" && props.field === "text") {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: {
                  type: "text",
                  text: props.delta,
                },
              },
            })
            .catch((error) => {
              log.error("failed to send reasoning delta to ACP", { error })
            })
        }
        return
      }
    }
  }

  public async processMessage(message: ProjectSessionMessageResponse) {
    log.debug("process message", message)
    if (message.info.role !== "assistant" && message.info.role !== "user") return
    const sessionId = message.info.sessionID

    for (const part of message.parts) {
      if (part.type === "tool") {
        await this.toolStart(sessionId, part)
        switch (part.state.status) {
          case "pending":
            this.bashSnapshots.delete(part.callID)
            break
          case "running": {
            const output = this.bashOutput(part)
            const runningContent: ToolCallContent[] = []
            if (output) {
              runningContent.push({
                type: "content",
                content: {
                  type: "text",
                  text: output,
                },
              })
            }
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "in_progress",
                  kind: toToolKind(part.tool),
                  title: part.tool,
                  locations: toLocations(part.tool, part.state.input),
                  rawInput: part.state.input,
                  ...(runningContent.length > 0 && { content: runningContent }),
                },
              })
              .catch((err) => {
                log.error("failed to send tool in_progress to ACP", { error: err })
              })
            break
          }
          case "completed": {
            this.toolStarts.delete(part.callID)
            this.bashSnapshots.delete(part.callID)
            const kind = toToolKind(part.tool)
            const content: ToolCallContent[] = [
              {
                type: "content",
                content: {
                  type: "text",
                  text: part.state.output,
                },
              },
            ]

            if (kind === "edit") {
              const input = part.state.input
              const filePath = typeof input.filePath === "string" ? input.filePath : ""
              const oldText = typeof input.oldString === "string" ? input.oldString : ""
              const newText =
                typeof input.newString === "string"
                  ? input.newString
                  : typeof input.content === "string"
                    ? input.content
                    : ""
              content.push({
                type: "diff",
                path: filePath,
                oldText,
                newText,
              })
            }

            if (part.tool === "todowrite") {
              const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
              if (parsedTodos.success) {
                await this.connection
                  .sessionUpdate({
                    sessionId,
                    update: {
                      sessionUpdate: "plan",
                      entries: parsedTodos.data.map((todo) => {
                        const status: PlanEntry["status"] =
                          todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                        return {
                          priority: "medium",
                          status,
                          content: todo.content,
                        }
                      }),
                    },
                  })
                  .catch((err) => {
                    log.error("failed to send session update for todo", { error: err })
                  })
              } else {
                log.error("failed to parse todo output", { error: parsedTodos.error })
              }
            }

            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "completed",
                  kind,
                  content,
                  title: part.state.title,
                  rawInput: part.state.input,
                  rawOutput: {
                    output: part.state.output,
                    metadata: part.state.metadata,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send tool completed to ACP", { error: err })
              })
            break
          }
          case "error":
            this.toolStarts.delete(part.callID)
            this.bashSnapshots.delete(part.callID)
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "failed",
                  kind: toToolKind(part.tool),
                  title: part.tool,
                  rawInput: part.state.input,
                  content: [
                    {
                      type: "content",
                      content: {
                        type: "text",
                        text: part.state.error,
                      },
                    },
                  ],
                  rawOutput: {
                    error: part.state.error,
                    metadata: part.state.metadata,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send tool error to ACP", { error: err })
              })
            break
        }
      } else if (part.type === "text") {
        if (part.text) {
          const audience: ("user" | "assistant")[] | undefined = part.synthetic
            ? ["assistant"]
            : part.ignored
              ? ["user"]
              : undefined
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
                content: {
                  type: "text",
                  text: part.text,
                  ...(audience && { annotations: { audience } }),
                },
              },
            })
            .catch((err) => {
              log.error("failed to send text to ACP", { error: err })
            })
        }
      } else if (part.type === "file") {
        const url = part.url
        const filename = part.filename ?? "file"
        const mime = part.mime || "application/octet-stream"
        const messageChunk = message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk"

        if (url.startsWith("file://")) {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: messageChunk,
                content: { type: "resource_link", uri: url, name: filename, mimeType: mime },
              },
            })
            .catch((err) => {
              log.error("failed to send resource_link to ACP", { error: err })
            })
        } else if (url.startsWith("data:")) {
          const base64Match = url.match(/^data:([^;]+);base64,(.*)$/)
          const dataMime = base64Match?.[1]
          const base64Data = base64Match?.[2] ?? ""

          const effectiveMime = dataMime || mime

          if (effectiveMime.startsWith("image/")) {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: messageChunk,
                  content: {
                    type: "image",
                    mimeType: effectiveMime,
                    data: base64Data,
                    uri: pathToFileURL(filename).href,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send image to ACP", { error: err })
              })
          } else {
            const isText = effectiveMime.startsWith("text/") || effectiveMime === "application/json"
            const fileUri = pathToFileURL(filename).href
            const resource = isText
              ? {
                  uri: fileUri,
                  mimeType: effectiveMime,
                  text: Buffer.from(base64Data, "base64").toString("utf-8"),
                }
              : { uri: fileUri, mimeType: effectiveMime, blob: base64Data }

            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: messageChunk,
                  content: { type: "resource", resource },
                },
              })
              .catch((err) => {
                log.error("failed to send resource to ACP", { error: err })
              })
          }
        }
      } else if (part.type === "reasoning") {
        if (part.text) {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "agent_thought_chunk",
                content: {
                  type: "text",
                  text: part.text,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send reasoning to ACP", { error: err })
            })
        }
      }
    }
  }

  private bashOutput(part: ToolPart) {
    if (part.tool !== "bash") return
    if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
    const output = part.state.metadata.output
    if (typeof output !== "string") return
    return output
  }

  private async toolStart(sessionId: string, part: ToolPart) {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: part.callID,
          title: part.tool,
          kind: toToolKind(part.tool),
          status: "pending",
          locations: [],
          rawInput: {},
        },
      })
      .catch((error) => {
        log.error("failed to send tool pending to ACP", { error })
      })
  }
}
