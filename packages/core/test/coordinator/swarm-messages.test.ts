import { describe, expect, test } from "bun:test"
import {
  createIdleNotification,
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  createShutdownRequestMessage,
  isIdleNotification,
  isPlanApprovalRequest,
  isPlanApprovalResponse,
  isShutdownApproved,
  isShutdownRejected,
  isShutdownRequest,
  isStructuredProtocolMessage,
} from "../../src/coordinator/swarm-messages"

describe("Structured Swarm Messages", () => {
  describe("IdleNotification", () => {
    test("creates correctly", () => {
      const msg = createIdleNotification("agent1", "available", "Waiting for tasks")
      expect(msg.type).toBe("idle_notification")
      expect(msg.agent_id).toBe("agent1")
      expect(msg.reason).toBe("available")
      expect(msg.detail).toBe("Waiting for tasks")
    })

    test("validates object correctly", () => {
      const msg = createIdleNotification("agent1")
      expect(isIdleNotification(msg)).toBeTrue()
      expect(isIdleNotification({ type: "wrong" })).toBeFalse()
    })

    test("validates JSON string correctly", () => {
      const msg = createIdleNotification("agent1")
      expect(isIdleNotification(JSON.stringify(msg))).toBeTrue()
      expect(isIdleNotification('{"type": "idle_notification"}')).toBeFalse() // missing agent_id and reason
      expect(isIdleNotification("invalid json")).toBeFalse()
    })
  })

  describe("ShutdownRequest", () => {
    test("creates correctly", () => {
      const msg = createShutdownRequestMessage("Task done")
      expect(msg.type).toBe("shutdown_request")
      expect(msg.reason).toBe("Task done")

      const msgNoReason = createShutdownRequestMessage()
      expect(msgNoReason.type).toBe("shutdown_request")
      expect(msgNoReason.reason).toBeUndefined()
    })

    test("validates correctly", () => {
      const msg = createShutdownRequestMessage()
      expect(isShutdownRequest(msg)).toBeTrue()
      expect(isShutdownRequest(JSON.stringify(msg))).toBeTrue()
      expect(isShutdownRequest({ type: "shutdown_request", extra: "ok" })).toBeTrue()
    })
  })

  describe("ShutdownApproved", () => {
    test("creates correctly", () => {
      const msg = createShutdownApprovedMessage("agent1")
      expect(msg.type).toBe("shutdown_approved")
      expect(msg.agent_id).toBe("agent1")
    })

    test("validates correctly", () => {
      const msg = createShutdownApprovedMessage("agent1")
      expect(isShutdownApproved(msg)).toBeTrue()
      expect(isShutdownApproved(JSON.stringify(msg))).toBeTrue()
    })
  })

  describe("ShutdownRejected", () => {
    test("creates correctly", () => {
      const msg = createShutdownRejectedMessage("agent1", "Busy")
      expect(msg.type).toBe("shutdown_rejected")
      expect(msg.agent_id).toBe("agent1")
      expect(msg.reason).toBe("Busy")
    })

    test("validates correctly", () => {
      const msg = createShutdownRejectedMessage("agent1", "Busy")
      expect(isShutdownRejected(msg)).toBeTrue()
      expect(isShutdownRejected(JSON.stringify(msg))).toBeTrue()
    })
  })

  describe("Plan Approval Stubs", () => {
    test("validates correctly", () => {
      const req = { type: "plan_approval_request", request_id: "1", plan_summary: "plan" }
      expect(isPlanApprovalRequest(req)).toBeTrue()

      const res = { type: "plan_approval_response", request_id: "1", approve: true }
      expect(isPlanApprovalResponse(res)).toBeTrue()
    })
  })

  describe("isStructuredProtocolMessage", () => {
    test("identifies known messages", () => {
      expect(isStructuredProtocolMessage(createIdleNotification("a"))).toBeTrue()
      expect(isStructuredProtocolMessage(createShutdownRequestMessage())).toBeTrue()
      expect(isStructuredProtocolMessage(createShutdownApprovedMessage("a"))).toBeTrue()
      expect(isStructuredProtocolMessage(createShutdownRejectedMessage("a", "b"))).toBeTrue()

      expect(
        isStructuredProtocolMessage({ type: "plan_approval_request", request_id: "1", plan_summary: "plan" }),
      ).toBeTrue()
      expect(isStructuredProtocolMessage({ type: "plan_approval_response", request_id: "1", approve: true })).toBeTrue()
    })

    test("rejects unknown messages", () => {
      expect(isStructuredProtocolMessage("Hello world")).toBeFalse()
      expect(isStructuredProtocolMessage({ type: "unknown_message" })).toBeFalse()
      expect(isStructuredProtocolMessage(null)).toBeFalse()
    })
  })
})
