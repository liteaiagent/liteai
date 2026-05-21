import { describe, expect, test } from "bun:test"
import { QuestionID } from "../../src/question/schema"
import { Request } from "../../src/question/service"
import { SessionID } from "../../src/session/schema"

describe("Question.Request schema", () => {
  const baseRequest = {
    id: QuestionID.ascending(),
    sessionID: SessionID.make("ses_test"),
    questions: [
      {
        question: "What should we do?",
        header: "Action",
        options: [{ label: "Build", description: "Build the project" }],
      },
    ],
  }

  test("accepts request without rootSessionID and agentName", () => {
    const result = Request.safeParse(baseRequest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rootSessionID).toBeUndefined()
      expect(result.data.agentName).toBeUndefined()
    }
  })

  test("accepts request with rootSessionID for bubble mode", () => {
    const result = Request.safeParse({
      ...baseRequest,
      rootSessionID: SessionID.make("ses_root"),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rootSessionID).toBe("ses_root")
    }
  })

  test("accepts request with agentName for subagent badge", () => {
    const result = Request.safeParse({
      ...baseRequest,
      agentName: "plan",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agentName).toBe("plan")
    }
  })

  test("accepts request with both rootSessionID and agentName", () => {
    const result = Request.safeParse({
      ...baseRequest,
      rootSessionID: SessionID.make("ses_root"),
      agentName: "explore",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rootSessionID).toBe("ses_root")
      expect(result.data.agentName).toBe("explore")
    }
  })

  test("accepts request with tool metadata alongside new fields", () => {
    const result = Request.safeParse({
      ...baseRequest,
      tool: {
        messageID: "msg_01" as ReturnType<typeof import("../../src/session/schema").MessageID.make>,
        callID: "call_123",
      },
      rootSessionID: SessionID.make("ses_parent"),
      agentName: "plan",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tool).toBeDefined()
      expect(result.data.rootSessionID).toBe("ses_parent")
      expect(result.data.agentName).toBe("plan")
    }
  })
})
