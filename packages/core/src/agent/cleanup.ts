import { Log } from "@/util/log"
import { clearSessionHooks } from "@/hook/hook"
import { unregisterPerfettoAgent } from "@/telemetry/perfetto"
import { SkillLoader } from "@/skill/loader"
import type { SubagentContext } from "./context"

const logger = Log.create({ service: "agent:cleanup" })

export interface AcquiredResources {
  mcpSession?: { cleanup: () => Promise<void> }
  hookRegistrations?: string[]
  cacheTracking?: string
  contextMessages?: unknown[]
  // Monitor cleanup hook, e.g. from liteai2 task registry
  monitorTaskCleanup?: () => Promise<void>
}

export namespace AgentCleanup {
  export async function execute(context: SubagentContext, resources: AcquiredResources): Promise<void> {
    logger.debug("Executing deterministic agent cleanup", { agentId: context.agentId })

    // Step 1: MCP connection cleanup
    try {
      if (resources.mcpSession) {
        await resources.mcpSession.cleanup()
      }
    } catch (err) {
      logger.warn("Cleanup step 1 (MCP) failed", { agentId: context.agentId, error: err })
    }

    // Step 2: Session hook removal
    try {
      clearSessionHooks(context.agentId)
    } catch (err) {
      logger.warn("Cleanup step 2 (Hooks) failed", { agentId: context.agentId, error: err })
    }

    // Step 3: Prompt cache tracking release (Placeholder for future prompt cache integration)
    try {
      if (resources.cacheTracking) {
        logger.debug("Releasing prompt cache block", { agentId: context.agentId, block: resources.cacheTracking })
      }
    } catch (err) {
      logger.warn("Cleanup step 3 (Cache) failed", { agentId: context.agentId, error: err })
    }

    // Step 4: File state cache clear
    try {
      if (context.readFileState) {
        context.readFileState.clear()
      }
    } catch (err) {
      logger.warn("Cleanup step 4 (File State) failed", { agentId: context.agentId, error: err })
    }

    // Step 5: Context message reference release
    try {
      if (resources.contextMessages && Array.isArray(resources.contextMessages)) {
        // Clear references
        resources.contextMessages.length = 0
      }
    } catch (err) {
      logger.warn("Cleanup step 5 (Messages) failed", { agentId: context.agentId, error: err })
    }

    // Step 6: Perfetto tracing unregister
    try {
      unregisterPerfettoAgent(context.agentId)
    } catch (err) {
      logger.warn("Cleanup step 6 (Perfetto) failed", { agentId: context.agentId, error: err })
    }

    // Step 7: Transcript subdir mapping cleanup
    try {
      // Future integration with SidechainTranscript directory sweeping. For now, files are kept for analytics.
    } catch (err) {
      logger.warn("Cleanup step 7 (Transcript) failed", { agentId: context.agentId, error: err })
    }

    // Step 8: Pending todo entry deletion
    try {
      // Using context.setAppStateForTasks instead of direct SQLite lookup ensures we target
      // the root state in an isolation-safe way if there are pending agent-scoped todos.
      context.setAppStateForTasks((state) => {
        // Typically, this would filter out todos specific to this agent if they exist.
        return state
      })
    } catch (err) {
      logger.warn("Cleanup step 8 (Todos) failed", { agentId: context.agentId, error: err })
    }

    // Step 9: Shell task killing
    try {
      // Future integration with PtyManager/Subprocess registry
    } catch (err) {
      logger.warn("Cleanup step 9 (Shell) failed", { agentId: context.agentId, error: err })
    }

    // Step 10: Monitor MCP task cleanup
    try {
      if (resources.monitorTaskCleanup) {
        await resources.monitorTaskCleanup()
      }
    } catch (err) {
      logger.warn("Cleanup step 10 (Monitor) failed", { agentId: context.agentId, error: err })
    }

    // Step 11: Invoked skill state clearing
    try {
      await SkillLoader.clearInvokedSkillsForAgent(context.agentId)
    } catch (err) {
      logger.warn("Cleanup step 11 (Skills) failed", { agentId: context.agentId, error: err })
    }

    // Step 12: Debug dump state clearing
    try {
      // Potential temp file or dump directory removal
    } catch (err) {
      logger.warn("Cleanup step 12 (Debug Dump) failed", { agentId: context.agentId, error: err })
    }
  }
}
