import { StoryWrapper } from "../__mocks__/story-wrapper"
import { PromptImageAttachments } from "./image-attachments"

const meta = {
  title: "Panes/Chat/PromptInput/ImageAttachments",
  component: PromptImageAttachments,
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
    attachments: [
      {
        id: "1",
        type: "image",
        filename: "screenshot.png",
        mime: "image/png",
        dataUrl: "https://placehold.co/100x100",
      } as unknown as import("../../shared/prompt").ImageAttachmentPart,
      {
        id: "2",
        type: "image",
        filename: "diagram.jpg",
        mime: "image/jpeg",
        dataUrl: "https://placehold.co/100x100",
      } as unknown as import("../../shared/prompt").ImageAttachmentPart,
    ],
    onOpen: (attachment: import("../../shared/prompt").ImageAttachmentPart) => console.log("open", attachment),
    onRemove: (id: string) => console.log("remove", id),
    removeLabel: "Remove",
  },
}
