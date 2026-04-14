import { NamedError } from "@liteai/util/error"
import z from "zod"

export const ConcurrentAgentLimitError = NamedError.create(
  "ConcurrentAgentLimitError",
  z.object({
    message: z.string(),
  }),
)

export const McpConnectionError = NamedError.create(
  "McpConnectionError",
  z.object({
    message: z.string(),
  }),
)

export const RequiredMcpServerError = NamedError.create(
  "RequiredMcpServerError",
  z.object({
    message: z.string(),
  }),
)

export const AgentSpawnError = NamedError.create(
  "AgentSpawnError",
  z.object({
    message: z.string(),
  }),
)

export const AgentTimeoutError = NamedError.create(
  "AgentTimeoutError",
  z.object({
    message: z.string(),
  }),
)
