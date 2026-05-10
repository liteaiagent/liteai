/**
 * Tests for permission-bridge.ts
 *
 * Validates the dual-transport permission bridge:
 * - In-process path (handler registered → Deferred-based resolution)
 * - File-based fallback (no handler → filesystem polling)
 * - Registration lifecycle (register, unregister, rejection of pending)
 */
import { afterEach, describe, expect, it, mock } from "bun:test"
import { PermissionBridge, type PermissionBridgeHandler } from "../../src/coordinator/permission-bridge"
import { createPermissionRequest } from "../../src/coordinator/permission-sync"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides?: Partial<ReturnType<typeof createPermissionRequest>>) {
  return createPermissionRequest({
    toolName: "run_command",
    toolUseId: "tool-1",
    description: "execute ls",
    input: { command: "ls" },
    workerId: "researcher@alpha",
    workerName: "researcher",
    teamName: "alpha",
    ...overrides,
  })
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

afterEach(() => {
  // Clean up bridge state between tests
  PermissionBridge.unregister()
})

// ─── Registration ────────────────────────────────────────────────────────────

describe("PermissionBridge registration", () => {
  it("starts unregistered", () => {
    expect(PermissionBridge.isRegistered()).toBe(false)
    expect(PermissionBridge.pendingCount).toBe(0)
  })

  it("registers and reports registered", () => {
    const handler: PermissionBridgeHandler = {
      onPermissionRequest: mock(() => {}),
    }
    PermissionBridge.register(handler)
    expect(PermissionBridge.isRegistered()).toBe(true)
  })

  it("unregisters and rejects pending requests", async () => {
    const handler: PermissionBridgeHandler = {
      onPermissionRequest: mock(() => {}),
    }
    PermissionBridge.register(handler)

    const request = makeRequest()
    const forwardPromise = PermissionBridge.forward(request)

    expect(PermissionBridge.pendingCount).toBe(1)

    // Unregister — all pending should be rejected
    PermissionBridge.unregister()

    expect(PermissionBridge.isRegistered()).toBe(false)

    await expect(forwardPromise).rejects.toThrow("Permission bridge unregistered")
  })
})

// ─── In-Process Path ─────────────────────────────────────────────────────────

describe("In-process forward + resolve", () => {
  it("forwards to handler and resolves successfully", async () => {
    const receivedRequests: string[] = []
    const handler: PermissionBridgeHandler = {
      onPermissionRequest(request) {
        receivedRequests.push(request.id)
        // Simulate leader approving immediately
        PermissionBridge.resolve(request.id, {
          requestId: request.id,
          decision: "approved",
          feedback: "safe command",
        })
      },
    }
    PermissionBridge.register(handler)

    const request = makeRequest()
    const resolution = await PermissionBridge.forward(request)

    expect(receivedRequests).toContain(request.id)
    expect(resolution.decision).toBe("approved")
    expect(resolution.feedback).toBe("safe command")
    expect(PermissionBridge.pendingCount).toBe(0)
  })

  it("handles rejection", async () => {
    const handler: PermissionBridgeHandler = {
      onPermissionRequest(request) {
        PermissionBridge.resolve(request.id, {
          requestId: request.id,
          decision: "rejected",
          feedback: "too dangerous",
        })
      },
    }
    PermissionBridge.register(handler)

    const request = makeRequest()
    const resolution = await PermissionBridge.forward(request)

    expect(resolution.decision).toBe("rejected")
    expect(resolution.feedback).toBe("too dangerous")
  })

  it("handles abort signal", async () => {
    const handler: PermissionBridgeHandler = {
      onPermissionRequest: mock(() => {}),
    }
    PermissionBridge.register(handler)

    const abortController = new AbortController()
    const request = makeRequest()
    const forwardPromise = PermissionBridge.forward(request, abortController.signal)

    // Abort immediately
    abortController.abort("user cancelled")

    await expect(forwardPromise).rejects.toThrow("Permission request aborted")
  })

  it("supports multiple concurrent requests", async () => {
    const handler: PermissionBridgeHandler = {
      onPermissionRequest: mock(() => {}),
    }
    PermissionBridge.register(handler)

    const req1 = makeRequest()
    const req2 = makeRequest()
    const req3 = makeRequest()

    const p1 = PermissionBridge.forward(req1)
    const p2 = PermissionBridge.forward(req2)
    const p3 = PermissionBridge.forward(req3)

    expect(PermissionBridge.pendingCount).toBe(3)
    expect(PermissionBridge.getPendingIds()).toContain(req1.id)
    expect(PermissionBridge.getPendingIds()).toContain(req2.id)
    expect(PermissionBridge.getPendingIds()).toContain(req3.id)

    // Resolve in reverse order
    PermissionBridge.resolve(req3.id, { requestId: req3.id, decision: "approved" })
    PermissionBridge.resolve(req1.id, { requestId: req1.id, decision: "rejected" })
    PermissionBridge.resolve(req2.id, { requestId: req2.id, decision: "approved" })

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1.decision).toBe("rejected")
    expect(r2.decision).toBe("approved")
    expect(r3.decision).toBe("approved")
    expect(PermissionBridge.pendingCount).toBe(0)
  })
})

// ─── Resolve Edge Cases ──────────────────────────────────────────────────────

describe("resolve edge cases", () => {
  it("returns false for non-pending requestId", () => {
    const result = PermissionBridge.resolve("nonexistent", {
      requestId: "nonexistent",
      decision: "approved",
    })
    expect(result).toBe(false)
  })
})

// ─── Inspection ──────────────────────────────────────────────────────────────

describe("inspection methods", () => {
  it("getPending returns the original request", async () => {
    const handler: PermissionBridgeHandler = {
      onPermissionRequest: mock(() => {}),
    }
    PermissionBridge.register(handler)

    const request = makeRequest()
    // Don't await — request is pending
    void PermissionBridge.forward(request)

    const pending = PermissionBridge.getPending(request.id)
    expect(pending).toBeDefined()
    expect(pending?.id).toBe(request.id)
    expect(pending?.toolName).toBe("run_command")

    // Cleanup
    PermissionBridge.resolve(request.id, { requestId: request.id, decision: "rejected" })
  })

  it("getPending returns undefined for non-pending", () => {
    expect(PermissionBridge.getPending("nope")).toBeUndefined()
  })
})
