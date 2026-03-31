import { StoryWrapper } from "./__mocks__/story-wrapper"
import { ChatPromptInput } from "./chat-prompt-input"

const meta = {
  title: "Panes/Chat/ChatPromptInput",
  component: ChatPromptInput,
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
      submit: async () => {},
      abort: () => {},
    },
    keybind: (id: string) => `Cmd+${id}`,
  },
}
