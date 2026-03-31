// @ts-nocheck

import { create } from "../storybook/scaffold"
import * as mod from "./message-part"

const mockMessage = {
  id: "msg-123",
  sessionID: "sess-1",
  role: "assistant",
  time: { created: Date.now() },
}

const mockParts = [
  {
    id: "part-1",
    type: "text",
    text: "Here is the information you requested:\\n\\nThis is a multiline response simulating an **Assistant** answering a query.",
  },
  {
    id: "part-2",
    type: "tool",
    tool: "run_command",
    state: {
      status: "completed",
      title: "ls -la",
      input: { command: "ls -la" },
    },
  },
]

const story = create({
  title: "UI/MessagePart",
  mod,
  name: "Message",
  args: {
    message: mockMessage,
    parts: mockParts,
  },
})

export default {
  title: "UI/MessagePart",
  id: "components-message-part",
  component: story.meta.component,
}
export const Basic = story.Basic

export const UserMessage = {
  ...story.Basic,
  args: {
    message: { ...mockMessage, role: "user" },
    parts: [
      { id: "u1", type: "text", text: "Can you list the files in this directory?" },
    ],
  },
}
