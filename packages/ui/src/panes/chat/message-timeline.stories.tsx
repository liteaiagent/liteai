import { StoryWrapper } from "./__mocks__/story-wrapper"
import { MessageTimeline } from "./message-timeline"

const meta = {
  title: "Panes/Chat/MessageTimeline",
  component: MessageTimeline,
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
    mobileChanges: false,
    mobileFallback: <div>Mobile Fallback View</div>,
    scroll: { overflow: false, bottom: true },
    onResumeScroll: () => {},
    setScrollRef: () => {},
    onScheduleScrollState: () => {},
    onAutoScrollHandleScroll: () => {},
    onMarkScrollGesture: () => {},
    hasScrollGesture: () => false,
    onUserScroll: () => {},
    onTurnBackfillScroll: () => {},
    onAutoScrollInteraction: () => {},
    centered: true,
    setContentRef: () => {},
    turnStart: 0,
    historyMore: false,
    historyLoading: false,
    onLoadEarlier: () => {},
    renderedUserMessages: [],
    anchor: (id: string) => `anchor-${id}`,
    sessionID: "mock-session",
    projectID: "mock-proj",
    sessionKey: "mock-proj:mock-session",
  },
}
