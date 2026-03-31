import { StoryWrapper } from "./__mocks__/story-wrapper"
import { ChatNewSession } from "./chat-new-session"

const meta = {
  title: "Panes/Chat/ChatNewSession",
  component: ChatNewSession,
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
  args: {},
}
