import { StoryWrapper } from "./__mocks__/story-wrapper"
import { ChatModelSelector } from "./chat-model-selector"

const meta = {
  title: "Panes/Chat/ChatModelSelector",
  component: ChatModelSelector,
  decorators: [
    (Story: import("solid-js").Component) => (
      <StoryWrapper>
        <div class="p-8 pb-[300px]">
          <Story />
        </div>
      </StoryWrapper>
    ),
  ],
  argTypes: {},
}

export default meta

export const Default = {
  args: {
    children: (
      <button
        type="button"
        class="px-3 py-1 bg-surface-base border border-border-base rounded shadow-sm text-text-strong"
      >
        Select Model
      </button>
    ),
  },
}
