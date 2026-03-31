import { StoryWrapper } from "./__mocks__/story-wrapper"
import { ChatPane } from "./chat-pane"

const meta = {
  title: "Panes/Chat/ChatPane",
  component: ChatPane,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: import("solid-js").Component) => (
      <StoryWrapper>
        <Story />
      </StoryWrapper>
    ),
  ],
  argTypes: {},
}

export default meta

export const Default = {
  args: {
    handler: {
      submit: async () => console.log("submit"),
      abort: () => console.log("abort"),
    },
    onSubmit: () => console.log("onSubmit"),
    onManageModels: () => console.log("manage models"),
    onConnectProvider: () => console.log("connect provider"),
    keybind: (id: string) => `Cmd+${id}`,
  },
}
