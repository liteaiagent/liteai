import { Context } from "../util/context"
import { Log } from "../util/log"
import type { WorkspaceID } from "./schema"

interface State {
  workspaceID?: WorkspaceID
}

const context = Context.create<State>("workspace")
const log = Log.create({ service: "workspace-context" })

export const WorkspaceContext = {
  async provide<R>(input: { workspaceID?: WorkspaceID; fn: () => R }): Promise<R> {
    return context.provide({ workspaceID: input.workspaceID }, async () => {
      return input.fn()
    })
  },

  get workspaceID() {
    try {
      return context.use().workspaceID
    } catch (error) {
      log.warn("Failed to get workspaceID from context", { error })
      return undefined
    }
  },
}
