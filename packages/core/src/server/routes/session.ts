import { Log } from "@liteai/util/log"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, PartID, PermissionModeAll, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/tasks/summary"
import { Snapshot } from "@/snapshot"
import { Agent } from "../../agent/agent"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/engine"
import { Message } from "../../session/message"
import { SessionRevert } from "../../session/revert"
import { SessionCompaction } from "../../session/tasks/compaction"
import { ContextBreakdown } from "../../session/tasks/context-breakdown"
import { Todo } from "../../session/todo"
import { FTS } from "../../storage/fts"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const SessionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all LiteAI sessions, sorted by most recently updated.",
        operationId: "project.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: z.coerce.boolean().optional().meta({ description: "Include archived sessions (default false)" }),
          tag: z.string().optional().meta({ description: "Filter sessions by tag" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          search: query.search,
          limit: query.limit,
          archived: query.archived,
          tag: query.tag,
        })) {
          sessions.push(session)
        }
        return c.json(sessions)
      },
    )
    .get(
      "/tags",
      describeRoute({
        summary: "Get session tags",
        description: "Retrieve all unique tags used across sessions.",
        operationId: "project.session.tags",
        responses: {
          200: {
            description: "List of tags",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = Session.listTags()
        return c.json(result)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "project.session.status",
        responses: {
          200: {
            description: "Get session status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = SessionStatus.list()
        return c.json(result)
      },
    )
    .get(
      "/history",
      describeRoute({
        summary: "Get session history",
        description:
          "Retrieve all historical user prompts across all sessions for the current project, deduped and sorted newest first.",
        operationId: "project.session.history",
        responses: {
          200: {
            description: "List of history entries",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      display: z.string(),
                      sessionID: z.string(),
                      timestamp: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const history = await Session.history({ limit: 500 })
        return c.json(history)
      },
    )
    .get(
      "/search",
      describeRoute({
        summary: "Search messages across sessions",
        description: "Full-text search across all session message content using FTS5.",
        operationId: "project.session.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      sessionID: z.string(),
                      messageID: z.string(),
                      role: z.string(),
                      snippet: z.string(),
                      rank: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          q: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const { q, limit } = c.req.valid("query")
        try {
          const results = FTS.search(q, limit ?? 50)
          return c.json(results)
        } catch (e) {
          log.warn("FTS search failed", { query: q, error: e })
          return c.json([])
        }
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific LiteAI session.",
        tags: ["Session"],
        operationId: "project.session.get",
        responses: {
          200: {
            description: "Get session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.get.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("SEARCH", { url: c.req.url })
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
        operationId: "project.session.children",
        responses: {
          200: {
            description: "List of children",
            content: {
              "application/json": {
                schema: resolver(Session.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.children.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.children(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
        operationId: "project.session.todo",
        responses: {
          200: {
            description: "Todo list",
            content: {
              "application/json": {
                schema: resolver(Todo.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const todos = await Todo.get(sessionID)
        return c.json(todos)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new LiteAI session for interacting with AI assistants and managing conversations.",
        operationId: "project.session.create",
        responses: {
          ...errors(400),
          200: {
            description: "Successfully created session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator("json", Session.create.schema.optional()),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const { isCoordinatorMode } = await import("../../coordinator")
        const sessionMode = body.sessionMode ?? (isCoordinatorMode() ? "Coordinator" : "Normal")
        const session = await Session.create({ ...body, sessionMode })
        return c.json(session)
      },
    )
    .delete(
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
        operationId: "project.session.delete",
        responses: {
          200: {
            description: "Successfully deleted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.remove.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.remove(sessionID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
        operationId: "project.session.update",
        responses: {
          200: {
            description: "Successfully updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
          sessionMode: z.enum(["Normal", "Coordinator", "Swarm"]).optional(),
          toolProfile: z.enum(["Plan", "Fast"]).optional(),
          forkEnabled: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        let session = await Session.get(sessionID)
        if (updates.title !== undefined) {
          session = await Session.setTitle({ sessionID, title: updates.title })
        }
        if (updates.time?.archived !== undefined) {
          session = await Session.setArchived({ sessionID, time: updates.time.archived })
        }
        if (
          updates.sessionMode !== undefined ||
          updates.toolProfile !== undefined ||
          updates.forkEnabled !== undefined
        ) {
          session = await Session.setConfig({
            sessionID,
            sessionMode: updates.sessionMode,
            toolProfile: updates.toolProfile,
            forkEnabled: updates.forkEnabled,
          })
        }
        if (updates.tags !== undefined) {
          session = await Session.setTags({ sessionID, tags: updates.tags })
        }

        return c.json(session)
      },
    )
    .post(
      "/:sessionID/init",
      describeRoute({
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
        operationId: "project.session.init",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", Session.initialize.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await Session.initialize({ ...body, sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
        operationId: "project.session.fork",
        responses: {
          200: {
            description: "200",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.fork.schema.shape.sessionID,
        }),
      ),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await Session.fork({ ...body, sessionID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
        operationId: "project.session.abort",
        responses: {
          200: {
            description: "Aborted session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/permission-mode",
      describeRoute({
        summary: "Set permission mode",
        description:
          "Set the active permission mode for a running session. Affects how tool permissions are evaluated in real-time.",
        operationId: "project.session.setPermissionMode",
        responses: {
          200: {
            description: "Permission mode updated",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    permissionMode: PermissionModeAll,
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          permissionMode: PermissionModeAll,
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { permissionMode } = c.req.valid("json")

        // Plan mode transitions are exclusively managed by plan_enter/plan_exit tools.
        // This route only toggles the permission mode enum — it does NOT activate/deactivate
        // plan mode state (planSessionID). Manual cycling to "plan" without a plan subagent
        // is allowed but does not spawn a subagent or set planSessionID.

        SessionPrompt.setPermissionMode(sessionID, permissionMode)
        return c.json({ permissionMode })
      },
    )
    .post(
      "/:sessionID/share",
      describeRoute({
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
        operationId: "project.session.share",
        responses: {
          200: {
            description: "Successfully shared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.share(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
        operationId: "project.session.diff",
        responses: {
          200: {
            description: "Successfully retrieved diff",
            content: {
              "application/json": {
                schema: resolver(Snapshot.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionSummary.diff.schema.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.diff.schema.shape.messageID,
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        const result = await SessionSummary.diff({
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
      },
    )
    .get(
      "/:sessionID/context",
      describeRoute({
        summary: "Get context breakdown",
        description: "Get a breakdown of token usage by category for the session's context window.",
        operationId: "project.session.context",
        responses: {
          200: {
            description: "Context breakdown",
            content: {
              "application/json": {
                schema: resolver(ContextBreakdown.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const result = await ContextBreakdown.get({ sessionID })
        return c.json(result)
      },
    )
    .delete(
      "/:sessionID/share",
      describeRoute({
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
        operationId: "project.session.unshare",
        responses: {
          200: {
            description: "Successfully unshared session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: Session.unshare.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.unshare(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
        operationId: "project.session.summarize",
        responses: {
          200: {
            description: "Summarized session",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await Agent.defaultAgent())
            break
          }
        }
        await SessionCompaction.create({
          sessionID,
          agent: currentAgent,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
        })
        await SessionPrompt.loop({ sessionID })
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
        operationId: "project.session.messages",
        responses: {
          200: {
            description: "List of messages",
            content: {
              "application/json": {
                schema: resolver(Message.WithParts.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z
          .object({
            limit: z.coerce
              .number()
              .int()
              .min(0)
              .optional()
              .meta({ description: "Maximum number of messages to return" }),
            before: z
              .string()
              .optional()
              .meta({ description: "Opaque cursor for loading older messages" })
              .refine(
                (value) => {
                  if (!value) return true
                  try {
                    Message.cursor.decode(value)
                    return true
                  } catch {
                    return false
                  }
                },
                { message: "Invalid cursor" },
              ),
          })
          .refine((value) => !value.before || value.limit !== undefined, {
            message: "before requires limit",
            path: ["before"],
          }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessionID = c.req.valid("param").sessionID
        if (query.limit === undefined) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        if (query.limit === 0) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        const page = await Message.page({
          sessionID,
          limit: query.limit,
          before: query.before,
        })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("limit", query.limit.toString())
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel="next"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        return c.json(page.items)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
        operationId: "project.session.message",
        responses: {
          200: {
            description: "Message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Info,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const message = await Message.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .delete(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Delete message",
        description:
          "Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.",
        operationId: "project.session.deleteMessage",
        responses: {
          200: {
            description: "Successfully deleted message",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        SessionPrompt.assertNotBusy(params.sessionID)
        await Session.removeMessage({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(true)
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "project.part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Session.removePart({
          sessionID: params.sessionID,
          messageID: params.messageID,
          partID: params.partID,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "project.part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: {
              "application/json": {
                schema: resolver(Message.Part),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      validator("json", Message.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
          )
        }
        const part = await Session.updatePart(body)
        return c.json(part)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
        operationId: "project.session.prompt",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          try {
            const msg = await SessionPrompt.prompt({ ...body, sessionID })
            stream.write(JSON.stringify(msg))
          } catch (e) {
            // AbortError is expected when the client disconnects mid-stream
            if (e instanceof DOMException && e.name === "AbortError") return

            // The error is already published via Bus → session.error SSE event
            // in the engine (queryLoop/runSession). Do NOT re-throw: the stream
            // callback has resolved and Hono cannot catch it, causing an
            // unhandled promise rejection that destabilizes the client.
            log.error("prompt stream failed", { error: e, sessionID })

            // Explicitly close the stream to prevent dangling HTTP connections
            // when the prompt throws (e.g. ModelNotFoundError)
            try {
              stream.close()
            } catch {
              /* ignore */
            }
          }
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "project.session.prompt_async",
        responses: {
          204: {
            description: "Prompt accepted",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(204)
        c.header("Content-Type", "application/json")
        return stream(c, async () => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          SessionPrompt.prompt({ ...body, sessionID }).catch((e) => {
            // AbortError is expected when session is cancelled
            if (e instanceof DOMException && e.name === "AbortError") return
            log.error("prompt_async failed", { error: e })
          })
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "project.session.command",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    info: Message.Assistant,
                    parts: Message.Part.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.command({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
        operationId: "project.session.shell",
        responses: {
          200: {
            description: "Created message",
            content: {
              "application/json": {
                schema: resolver(Message.Assistant),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
        operationId: "project.session.revert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("revert", c.req.valid("json"))
        const session = await SessionRevert.revert({
          sessionID,
          ...c.req.valid("json"),
        })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
        operationId: "project.session.unrevert",
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await SessionRevert.unrevert({ sessionID })
        return c.json(session)
      },
    )
    // ── Backward Execution: Step-Level Control ──
    .post(
      "/:sessionID/resume",
      describeRoute({
        summary: "Resume a paused session",
        description: "Resume a session paused in step mode, optionally injecting user guidance or disabling step mode.",
        operationId: "project.session.resume",
        responses: {
          200: {
            description: "Session resumed",
            content: {
              "application/json": {
                schema: resolver(z.object({ resumed: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          guidance: z.string().optional(),
          disableStepMode: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        SessionPrompt.resumeStepMode(sessionID, body)
        return c.json({ resumed: true })
      },
    )
    .post(
      "/:sessionID/step-back",
      describeRoute({
        summary: "Step back to a previous checkpoint",
        description:
          "Revert the session state and workspace files to a specific historical checkpoint. This is a destructive action that truncates newer messages.",
        operationId: "project.session.step_back",
        responses: {
          200: {
            description: "Session reverted to checkpoint",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    restored: z.boolean(),
                    step: z.number(),
                    orphanedChildren: z.array(SessionID.zod),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          checkpointID: z.string(),
          guidance: z.string().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const { stepBack } = await import("../../session/step-back")
          const result = await stepBack({ sessionID, ...body })
          return c.json(result)
        } catch (error) {
          if (error && typeof error === "object" && "name" in error) {
            if (error.name === "CheckpointNotFoundError") {
              return c.json({ error: (error as Error).message }, 404)
            }
            if (error.name === "FileConflictError") {
              const conflicts = (error as Error & { data?: { conflicts?: string[] } }).data?.conflicts
              return c.json({ error: (error as Error).message, conflicts }, 409)
            }
            if (error.name === "SnapshotTrackingError" || error.name === "CheckpointEmptyMessagesError") {
              return c.json({ error: (error as Error).message }, 500)
            }
          }
          throw error
        }
      },
    )
    .post(
      "/:sessionID/fork-at",
      describeRoute({
        summary: "Fork session at checkpoint",
        description:
          "Create a new independent session branching off from a specific historical checkpoint. Optionally override the model or agent.",
        operationId: "project.session.forkAt",
        responses: {
          200: {
            description: "Session forked successfully",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          checkpointID: z.string(),
          model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }).optional(),
          agent: z.string().optional(),
          guidance: z.string().optional(),
          autoResume: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        try {
          const newSession = await Session.forkAtCheckpoint({ sessionID, ...body })
          if (body.autoResume) {
            SessionPrompt.loop({ sessionID: newSession.id }).catch((e) =>
              log.error("auto-resume failed for forked session", { error: e, sessionID: newSession.id }),
            )
          }
          return c.json(newSession)
        } catch (error) {
          if (error && typeof error === "object" && "name" in error) {
            const name = (error as Error).name
            if (name === "CheckpointNotFoundError") {
              return c.json({ error: (error as Error).message }, 404)
            }
            if (name === "ForkProviderModelNotFoundError" || name === "ForkAgentNotFoundError") {
              return c.json({ error: (error as Error).message }, 400)
            }
          }
          throw error
        }
      },
    )
    .get(
      "/:sessionID/checkpoints",
      describeRoute({
        summary: "List checkpoints for a session",
        description: "Get all step-level checkpoints for a session, ordered by step. Messages are excluded.",
        operationId: "project.session.checkpoints",
        responses: {
          200: {
            description: "List of checkpoint summaries",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const { CheckpointStoreManager } = await import("../../session/engine/loop/checkpoint-store")
        const checkpoints = CheckpointStoreManager.listCheckpoints(sessionID)
        // Return summaries without messages (too large for list endpoint)
        const summaries = checkpoints.map(({ messages: _messages, ...rest }) => rest)
        return c.json(summaries)
      },
    )
    .get(
      "/:sessionID/checkpoints/:checkpointID",
      describeRoute({
        summary: "Get a specific checkpoint",
        description: "Get full checkpoint data including messages for a specific checkpoint.",
        operationId: "project.session.checkpoint",
        responses: {
          200: {
            description: "Full checkpoint data",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          checkpointID: z.string(),
        }),
      ),
      async (c) => {
        const { sessionID, checkpointID } = c.req.valid("param")
        const { CheckpointStoreManager } = await import("../../session/engine/loop/checkpoint-store")
        const checkpoint = CheckpointStoreManager.getCheckpoint(sessionID, checkpointID)
        if (!checkpoint) {
          return c.json({ error: `Checkpoint not found: ${checkpointID}` }, 404)
        }
        return c.json(checkpoint)
      },
    ),
)
