export class ConcurrentAgentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConcurrentAgentLimitError"
  }
}

export class AgentDisabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentDisabledError"
  }
}

export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpConnectionError"
  }
}

export class RequiredMcpServerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RequiredMcpServerError"
  }
}

export class AgentSpawnError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentSpawnError"
  }
}

export class AgentTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentTimeoutError"
  }
}
