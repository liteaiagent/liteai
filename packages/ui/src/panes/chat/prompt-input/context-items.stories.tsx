import { StoryWrapper } from "../__mocks__/story-wrapper"
import { PromptContextItems } from "./context-items"

const meta = {
  title: "Panes/Chat/PromptInput/ContextItems",
  component: PromptContextItems,
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
    items: [
      {
        key: "1",
        path: "src/panes/chat/chat-pane.tsx",
        selection: { startLine: 1, endLine: 10 },
        comment: "Check this out",
      },
      { key: "2", path: "src/utils/math.ts" },
    ],
    active: (item: import("../../shared/prompt").ContextItem & { key: string }) => item.key === "1",
    openComment: (item: import("../../shared/prompt").ContextItem & { key: string }) =>
      console.log("open comment", item),
    remove: (item: import("../../shared/prompt").ContextItem & { key: string }) => console.log("remove", item),
    t: (key: string) => key,
  },
}
