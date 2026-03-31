import type { SelectionController } from "@liteai/ui/panes"
import { useLocal } from "./local"

/**
 * Creates a SelectionController backed by the web app's useLocal().
 *
 * This adapter wraps the existing local/models/providers infrastructure
 * into the abstract SelectionController interface, allowing chat components
 * to manage model/agent selection without depending on the HTTP/SSE layer.
 */
export function createWebSelectionController(): SelectionController {
  const local = useLocal()

  return {
    agent: {
      current() {
        return local.agent.current()
      },
      list() {
        return local.agent.list()
      },
      set(name: string | undefined) {
        local.agent.set(name)
      },
    },
    model: {
      current() {
        return local.model.current()
      },
      list() {
        return local.model.list()
      },
      visible(key) {
        return local.model.visible(key)
      },
      set(key, options) {
        local.model.set(key, options)
      },
      variant: {
        current() {
          return local.model.variant.current()
        },
        list() {
          return local.model.variant.list()
        },
        set(value) {
          local.model.variant.set(value)
        },
      },
    },
  }
}
