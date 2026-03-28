import type { McpServer } from "@agentclientprotocol/sdk"
import type { LiteaiClient } from "@liteai/sdk"
import type { ModelID, ProviderID } from "../provider/schema"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: LiteaiClient
  defaultModel?: {
    providerID: ProviderID
    modelID: ModelID
  }
}
