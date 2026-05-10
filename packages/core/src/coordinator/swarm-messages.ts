import { z } from "zod"

// ─── Idle Notification ───────────────────────────────────────────────

export const IdleNotificationSchema = z.object({
  type: z.literal("idle_notification"),
  agent_id: z.string(),
  reason: z.enum(["available", "interrupted", "failed", "plan_completed"]),
  detail: z.string().optional(),
})

export type IdleNotificationMessage = z.infer<typeof IdleNotificationSchema>

export function createIdleNotification(
  agentId: string,
  reason: IdleNotificationMessage["reason"] = "available",
  detail?: string,
): IdleNotificationMessage {
  return {
    type: "idle_notification",
    agent_id: agentId,
    reason,
    ...(detail ? { detail } : {}),
  }
}

export function isIdleNotification(data: unknown): data is IdleNotificationMessage {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data)
      return IdleNotificationSchema.safeParse(parsed).success
    } catch {
      return false
    }
  }
  return IdleNotificationSchema.safeParse(data).success
}

// ─── Shutdown Request ────────────────────────────────────────────────

export const ShutdownRequestSchema = z.object({
  type: z.literal("shutdown_request"),
  reason: z.string().optional(),
})

export type ShutdownRequestMessage = z.infer<typeof ShutdownRequestSchema>

export function createShutdownRequestMessage(reason?: string): ShutdownRequestMessage {
  return {
    type: "shutdown_request",
    ...(reason ? { reason } : {}),
  }
}

export function isShutdownRequest(data: unknown): data is ShutdownRequestMessage {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data)
      return ShutdownRequestSchema.safeParse(parsed).success
    } catch {
      return false
    }
  }
  return ShutdownRequestSchema.safeParse(data).success
}

// ─── Shutdown Approved ───────────────────────────────────────────────

export const ShutdownApprovedSchema = z.object({
  type: z.literal("shutdown_approved"),
  agent_id: z.string(),
})

export type ShutdownApprovedMessage = z.infer<typeof ShutdownApprovedSchema>

export function createShutdownApprovedMessage(agentId: string): ShutdownApprovedMessage {
  return {
    type: "shutdown_approved",
    agent_id: agentId,
  }
}

export function isShutdownApproved(data: unknown): data is ShutdownApprovedMessage {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data)
      return ShutdownApprovedSchema.safeParse(parsed).success
    } catch {
      return false
    }
  }
  return ShutdownApprovedSchema.safeParse(data).success
}

// ─── Shutdown Rejected ───────────────────────────────────────────────

export const ShutdownRejectedSchema = z.object({
  type: z.literal("shutdown_rejected"),
  agent_id: z.string(),
  reason: z.string(),
})

export type ShutdownRejectedMessage = z.infer<typeof ShutdownRejectedSchema>

export function createShutdownRejectedMessage(agentId: string, reason: string): ShutdownRejectedMessage {
  return {
    type: "shutdown_rejected",
    agent_id: agentId,
    reason,
  }
}

export function isShutdownRejected(data: unknown): data is ShutdownRejectedMessage {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data)
      return ShutdownRejectedSchema.safeParse(parsed).success
    } catch {
      return false
    }
  }
  return ShutdownRejectedSchema.safeParse(data).success
}

// ─── Plan Approval Request/Response (Phase 3 Stubs) ──────────────────

export const PlanApprovalRequestSchema = z.object({
  type: z.literal("plan_approval_request"),
  request_id: z.string(),
  plan_summary: z.string(),
})

export type PlanApprovalRequestMessage = z.infer<typeof PlanApprovalRequestSchema>

export function isPlanApprovalRequest(data: unknown): data is PlanApprovalRequestMessage {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data)
      return PlanApprovalRequestSchema.safeParse(parsed).success
    } catch {
      return false
    }
  }
  return PlanApprovalRequestSchema.safeParse(data).success
}

export const PlanApprovalResponseSchema = z.object({
  type: z.literal("plan_approval_response"),
  request_id: z.string(),
  approve: z.boolean(),
  feedback: z.string().optional(),
})

export type PlanApprovalResponseMessage = z.infer<typeof PlanApprovalResponseSchema>

export function isPlanApprovalResponse(data: unknown): data is PlanApprovalResponseMessage {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data)
      return PlanApprovalResponseSchema.safeParse(parsed).success
    } catch {
      return false
    }
  }
  return PlanApprovalResponseSchema.safeParse(data).success
}

// ─── Protocol Message Aggregation ────────────────────────────────────

/**
 * Checks if the given payload (object or JSON string) is any known
 * structured protocol message.
 */
export function isStructuredProtocolMessage(data: unknown): boolean {
  if (typeof data === "string") {
    try {
      data = JSON.parse(data)
    } catch {
      return false
    }
  }

  return (
    isIdleNotification(data) ||
    isShutdownRequest(data) ||
    isShutdownApproved(data) ||
    isShutdownRejected(data) ||
    isPlanApprovalRequest(data) ||
    isPlanApprovalResponse(data)
  )
}
