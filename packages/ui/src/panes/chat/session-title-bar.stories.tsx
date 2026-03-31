import { StoryWrapper } from "./__mocks__/story-wrapper"
import { SessionTitleBar } from "./session-title-bar"

const meta = {
  title: "Panes/Chat/SessionTitleBar",
  component: SessionTitleBar,
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
    sessionID: () => "mock-session",
    projectID: () => "mock-project",
    sessionKey: "mock-project:mock-session",
    centered: true,
    working: false,
    tint: undefined,
  },
}

export const Working = {
  args: {
    sessionID: () => "mock-session",
    projectID: () => "mock-project",
    sessionKey: "mock-project:mock-session",
    centered: true,
    working: true,
    tint: "#3b82f6",
  },
}
