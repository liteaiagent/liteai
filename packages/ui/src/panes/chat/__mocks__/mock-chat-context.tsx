import type { Agent, Config, Provider } from "@liteai/sdk/client"
import type { ParentProps } from "solid-js"
import { ChatContextProvider } from "../../controllers/chat-context"
import type { ChatController, ProjectInfo } from "../../controllers/chat-controller"
import type { SelectionController } from "../../controllers/selection-controller"
import type { SessionController } from "../../controllers/session-controller"
import { PromptProvider } from "../../shared/prompt"

/** Minimal Mock Chat Controller */
export function createMockChatController(overrides?: Partial<ChatController>): ChatController {
  return {
    messages: () => [],
    messagesReady: () => true,
    parts: () => [],
    sessionStatus: () => ({ type: "idle" }),
    agents: () => [{ name: "lite", mode: "default", type: "agent", config: {} } as unknown as Agent],
    session: {
      get: () => undefined,
      sync: async () => {},
      history: {
        more: () => false,
        loading: () => false,
        loadMore: async () => {},
      },
    },
    config: () => ({}) as Config,
    directory: () => "/mock/dir",
    projectID: () => "mock-proj",
    sessions: () => [],
    project: () => ({ time: { created: Date.now() } }) as ProjectInfo,
    vcs: () => undefined,
    shareEnabled: () => false,
    commands: () => [],
    hasPaidProviders: () => true,
    ...overrides,
  }
}

/** Minimal Mock Selection Controller */
export function createMockSelectionController(overrides?: Partial<SelectionController>): SelectionController {
  return {
    agent: {
      current: () => ({ name: "lite", mode: "default", type: "agent", config: {} }) as unknown as Agent,
      set: () => {},
      list: () => [{ name: "lite", mode: "default", type: "agent", config: {} } as unknown as Agent],
    },
    model: {
      current: () =>
        ({
          name: "GPT-4",
          provider: { id: "openai" } as Provider,
        }) as unknown as import("../../controllers/model-controller").ModelInfo,
      set: () => {},
      list: () => [],
      visible: () => true,
      variant: {
        current: () => undefined,
        set: () => {},
        list: () => [],
      },
    },
    ...overrides,
  }
}

/** Minimal Mock Session Controller */
export function createMockSessionController(overrides?: Partial<SessionController>): SessionController {
  return {
    rename: async () => {},
    delete: async () => false,
    archive: async () => {},
    share: async () => {},
    unshare: async () => {},
    ...overrides,
  }
}

export function MockChatProviders(
  props: ParentProps<{
    chat?: Partial<ChatController>
    selection?: Partial<SelectionController>
    session?: Partial<SessionController>
  }>,
) {
  const chat = createMockChatController(props.chat)
  const selection = createMockSelectionController(props.selection)
  const session = createMockSessionController(props.session)

  return (
    <ChatContextProvider chat={chat} selection={selection} session={session}>
      <PromptProvider>{props.children}</PromptProvider>
    </ChatContextProvider>
  )
}
