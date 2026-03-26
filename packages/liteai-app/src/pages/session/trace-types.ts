export type TraceInfo = {
  id: string
  sessionID: string
  messageID: string
  step: number
  agent: string
  modelID: string
  providerID: string
  params: Record<string, unknown> | null
  hasSystem: boolean
  hasTools: boolean
  contextSize: number
  timeStart: number
  timeEnd: number | null
  timeCreated: number
  error: string | null
}

export type TraceDetail = TraceInfo & {
  system: string | null
  tools: Record<string, unknown>[] | null
  hooks: Record<string, unknown>[] | null
  messages_json?: Record<string, unknown>[] | null
  contextIDs: string[]
}

export type TracePartData = Record<string, unknown> & {
  type?: string
  text?: string
  toolName?: string
  args?: unknown
  result?: unknown
  tool?: string
  state?: { title?: string; input?: unknown; output?: unknown }
  reason?: string
  tokens?: { input: number; output: number; reasoning: number }
  name?: string
  synthetic?: boolean
}

export type TraceMessageData = Record<string, unknown> & {
  id: string
  role?: string
}
