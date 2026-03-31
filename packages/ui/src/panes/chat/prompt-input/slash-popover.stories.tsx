import { StoryWrapper } from "../__mocks__/story-wrapper"
import { PromptPopover } from "./slash-popover"

const meta = {
  title: "Panes/Chat/PromptInput/SlashPopover",
  component: PromptPopover as unknown as import("solid-js").Component,
  decorators: [
    (Story: import("solid-js").Component) => (
      <StoryWrapper>
        <div class="relative h-[400px] w-full mt-auto">
          <Story />
        </div>
      </StoryWrapper>
    ),
  ],
  argTypes: {},
}

export default meta

export const AtMention = {
  args: {
    popover: "at",
    setSlashPopoverRef: () => {},
    atFlat: [
      { type: "agent", name: "lite", display: "@lite" },
      { type: "file", path: "src/panes/chat/chat-pane.tsx", display: "chat-pane.tsx" },
      { type: "file", path: "src/utils/math.ts", display: "math.ts" },
    ],
    atActive: "agent:lite",
    atKey: (item: import("./slash-popover").AtOption) =>
      item.type === "agent" ? `agent:${item.name}` : `file:${item.path}`,
    setAtActive: () => {},
    onAtSelect: () => {},
    slashFlat: [],
    setSlashActive: () => {},
    onSlashSelect: () => {},
    commandKeybind: () => undefined,
    t: (key: string) => key,
  } as unknown as import("solid-js").ComponentProps<typeof PromptPopover>,
}

export const SlashCommand = {
  args: {
    popover: "slash",
    setSlashPopoverRef: () => {},
    atFlat: [],
    atKey: (_item: import("./slash-popover").AtOption) => "",
    setAtActive: () => {},
    onAtSelect: () => {},
    slashFlat: [
      { id: "help", trigger: "help", title: "Help", description: "Show help commands", type: "builtin" },
      {
        id: "clear",
        trigger: "clear",
        title: "Clear",
        description: "Clear current session",
        type: "custom",
        source: "skill",
      },
    ],
    slashActive: "help",
    setSlashActive: () => {},
    onSlashSelect: () => {},
    commandKeybind: (id: string) => (id === "help" ? "Cmd+H" : undefined),
    t: (key: string) => key,
  } as unknown as import("solid-js").ComponentProps<typeof PromptPopover>,
}
