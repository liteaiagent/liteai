/**
 * Session context — manages the active session lifecycle for the CLI TUI.
 *
 * This is a **pure CLI-layer concern**: it orchestrates SDK calls for session
 * creation, prompt submission, abort, and status tracking. It does NOT contain
 * any core business logic.
 *
 * Responsibilities:
 * 1. Active session tracking — from `useRoute()` (if resuming) or auto-created
 * 2. Session creation — auto-creates on first submit if no session exists
 * 3. Submit orchestration — routes to `session.prompt()` or slash commands
 * 4. Abort flow — `session.abort()` when user presses Escape during loading
 * 5. Loading state — derived from `useSync().session.status(sessionID)`
 * 6. Message history — for `useArrowKeyHistory` from sync store
 */

import { Log } from "@liteai/core/util/log"
import type { FilePartInput, TextPartInput } from "@liteai/sdk"
import { useCallback, useMemo, useRef, useState } from "react"
import type { PromptInputMode } from "../types/text-input"
import { createSimpleContext } from "./helper"
import { useLocal } from "./local"
import { useRoute } from "./route"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useToast } from "./toast"

// ─── Types ───────────────────────────────────────────────────────────────────

export type SessionContextValue = {
  /** Current session ID, undefined if no session has been created yet */
  readonly sessionID: string | undefined
  /** Whether a prompt is currently in-flight */
  readonly isLoading: boolean
  /** Submit a prompt to the session, creating one if needed */
  submit(input: string, mode: PromptInputMode, attachments?: FilePartInput[]): Promise<void>
  /** Abort the active session */
  abort(): Promise<void>
}

// ─── Context ─────────────────────────────────────────────────────────────────

export const { use: useSession, provider: SessionProvider } = createSimpleContext({
  name: "Session",
  init: () => {
    const sdk = useSDK()
    const route = useRoute()
    const sync = useSync()
    const local = useLocal()
    const toast = useToast()

    // Track session ID: either from route (resuming) or auto-created
    const initialSessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const [createdSessionID, setCreatedSessionID] = useState<string | undefined>(undefined)
    const sessionID = initialSessionID ?? createdSessionID

    // Guard against concurrent session creation
    const creatingRef = useRef(false)

    // ── Loading state ─────────────────────────────────────────────────────

    const isLoading = useMemo(() => {
      if (!sessionID) return false
      return sync.session.status(sessionID) === "working"
    }, [sessionID, sync])

    // ── Session creation ──────────────────────────────────────────────────

    const ensureSession = useCallback(async (): Promise<string> => {
      if (sessionID) return sessionID

      if (creatingRef.current) {
        throw new Error("Session creation already in progress")
      }
      creatingRef.current = true

      try {
        const result = await sdk.client.project.session.create({ projectID: sdk.projectID }, { throwOnError: true })
        const newID = result.data?.id
        if (!newID) {
          throw new Error("Session creation returned no ID")
        }
        setCreatedSessionID(newID)

        // Navigate to the session route so sync picks it up
        route.navigate({ type: "session", sessionID: newID })

        return newID
      } catch (e) {
        Log.Default.error("[session] Failed to create session", { error: e })
        toast.error(e)
        throw e
      } finally {
        creatingRef.current = false
      }
    }, [sessionID, sdk, route, toast])

    // ── Submit ────────────────────────────────────────────────────────────

    const submit = useCallback(
      async (input: string, mode: PromptInputMode, attachments?: FilePartInput[]) => {
        const activeSessionID = await ensureSession()
        const model = local.model.current()
        const agent = local.agent.current()

        // Build message parts
        const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: input }]
        if (attachments) {
          parts.push(...attachments)
        }

        try {
          if (mode === "bash") {
            // Bash mode: send as a shell command via prompt with the bash prefix
            await sdk.client.project.session.prompt({
              sessionID: activeSessionID,
              projectID: sdk.projectID,
              parts,
              model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
              agent: agent?.name,
              variant: local.model.variant.current(),
            })
          } else {
            // Prompt mode: standard message
            await sdk.client.project.session.prompt({
              sessionID: activeSessionID,
              projectID: sdk.projectID,
              parts,
              model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
              agent: agent?.name,
              variant: local.model.variant.current(),
            })
          }
        } catch (e) {
          Log.Default.error("[session] Failed to submit prompt", { error: e })
          toast.error(e)
        }
      },
      [ensureSession, sdk, local, toast],
    )

    // ── Abort ─────────────────────────────────────────────────────────────

    const abort = useCallback(async () => {
      if (!sessionID) return
      try {
        await sdk.client.project.session.abort({
          sessionID,
          projectID: sdk.projectID,
        })
      } catch (e) {
        Log.Default.error("[session] Failed to abort session", { error: e })
        toast.error(e)
      }
    }, [sessionID, sdk, toast])

    // ── Value ─────────────────────────────────────────────────────────────

    return useMemo<SessionContextValue>(
      () => ({ sessionID, isLoading, submit, abort }),
      [sessionID, isLoading, submit, abort],
    )
  },
})
