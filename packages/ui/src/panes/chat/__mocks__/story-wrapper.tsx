import { createSignal, type ParentProps } from "solid-js"
import { Toast } from "../../../components/toast"
import { DialogProvider } from "../../../context/dialog"
import { PaneProviders } from "../../shared/pane-providers"
import { MockChatProviders } from "./mock-chat-context"

export function StoryWrapper(
  props: ParentProps<{
    route?: import("../../shared/pane-route").PaneRoute
    chat?: Partial<import("../../controllers/chat-controller").ChatController>
    selection?: Partial<import("../../controllers/selection-controller").SelectionController>
    session?: Partial<import("../../controllers/session-controller").SessionController>
    permission?: Partial<import("../../controllers/permission-controller").PermissionController>
  }>,
) {
  const [route, _setRoute] = createSignal(
    props.route ?? { type: "chat", projectID: "mock-proj", sessionID: "mock-session" },
  )

  return (
    <DialogProvider>
      <PaneProviders
        platform={"vscode" as unknown as import("../../shared/platform").Platform}
        route={route}
        dictionaries={{ en: {} } as unknown as Record<import("../../shared/language").Locale, Record<string, unknown>>}
      >
        <MockChatProviders
          chat={props.chat}
          selection={props.selection}
          session={props.session}
          permission={props.permission}
        >
          <div class="@container h-[600px] w-[500px] bg-background-stronger overflow-hidden border border-border-weak relative flex flex-col">
            {props.children}
          </div>
          <Toast.Region />
        </MockChatProviders>
      </PaneProviders>
    </DialogProvider>
  )
}
