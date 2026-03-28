import type { z } from "zod"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  info: any
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  options: Record<string, any>
}

export type PluginInput = {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  client: any
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  project: any
  directory: string
  worktree: string
  serverUrl: URL
  $: typeof Bun.$
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export type AuthHook = {
  provider: string
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  loader?: (auth: () => Promise<any>, provider: any) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOauthResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOauthResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
                clientId?: string
                clientSecret?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
  | {
      method: "code"
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
                clientId?: string
                clientSecret?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
)

export interface Hooks {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  event?: (input: { event: any }) => Promise<void>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  config?: (input: any) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    output: { message: any; parts: any[] },
  ) => Promise<void>
  "chat.params"?: (
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    input: { sessionID: string; agent: string; model: any; provider: ProviderContext; message: any },
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  "chat.headers"?: (
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    input: { sessionID: string; agent: string; model: any; provider: ProviderContext; message: any },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  "permission.ask"?: (input: any, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    output: { parts: any[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "tool.execute.after"?: (
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      // biome-ignore lint/suspicious/noExplicitAny: dynamic
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: {
      messages: {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic
        info: any
        // biome-ignore lint/suspicious/noExplicitAny: dynamic
        parts: any[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    input: { sessionID?: string; model: any },
    output: {
      system: string[]
    },
  ) => Promise<void>
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  "session.start"?: (input: { sessionID: string }, output: Record<string, never>) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
}

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: {
    permission: string
    patterns: string[]
    always: string[]
    // biome-ignore lint/suspicious/noExplicitAny: dynamic
    metadata: { [key: string]: any }
  }): Promise<void>
}

export type ToolDefinition = {
  description: string
  args: z.ZodRawShape
  // biome-ignore lint/suspicious/noExplicitAny: dynamic
  execute(args: any, context: ToolContext): Promise<string>
}
