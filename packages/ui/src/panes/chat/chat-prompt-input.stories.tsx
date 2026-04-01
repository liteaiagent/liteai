// @ts-nocheck
import { createEffect } from "solid-js"
import { type ContextItem, type Prompt, usePrompt } from "../shared/prompt"
import { StoryWrapper } from "./__mocks__/story-wrapper"
import { ChatPromptInput } from "./chat-prompt-input"

function PromptState(props: {
  parts?: Prompt
  contextItems?: ContextItem[]
  children: import("solid-js").JSX.Element
}) {
  const prompt = usePrompt()
  createEffect(() => {
    if (props.parts) {
      prompt.set(
        props.parts,
        props.parts.map((p: { content?: string }) => ("content" in p ? p.content : "")).join("").length,
      )
    }
    if (props.contextItems) {
      for (const item of props.contextItems) {
        prompt.context.add(item)
      }
    }
  })

  return props.children
}

const meta = {
  title: "Panes/Chat/ChatPromptInput",
  component: ChatPromptInput,
  decorators: [
    (Story: import("solid-js").Component) => (
      <StoryWrapper
        chat={{
          commands: () => [{ name: "test", description: "A test command", source: "test" } as never],
          hasPaidProviders: () => true,
        }}
      >
        <Story />
      </StoryWrapper>
    ),
  ],
  args: {
    handler: {
      submit: async () => {},
      abort: () => {},
    },
    keybind: (id: string) => `Cmd+${id}`,
  },
}

export default meta

export const Default = {}

export const WithContent = {
  decorators: [
    (Story: import("solid-js").Component) => (
      <PromptState parts={[{ type: "text", content: "How do I center a div?", start: 0, end: 24 }]}>
        <Story />
      </PromptState>
    ),
  ],
}

export const ShellMode = {
  decorators: [
    (Story: import("solid-js").Component) => (
      <PromptState parts={[{ type: "text", content: "!ls -la", start: 0, end: 7 }]}>
        <Story />
      </PromptState>
    ),
  ],
}

export const BusySession = {
  decorators: [
    (Story: import("solid-js").Component) => (
      <StoryWrapper chat={{ sessionStatus: () => ({ type: "busy" }) }}>
        <Story />
      </StoryWrapper>
    ),
  ],
}

export const WithContextItems = {
  decorators: [
    (Story: import("solid-js").Component) => (
      <PromptState
        contextItems={[
          {
            type: "file",
            path: "src/App.tsx",
            selection: { startLine: 1, endLine: 10, startChar: 0, endChar: 3 },
          },
          { type: "file", path: "src/utils.ts" },
        ]}
      >
        <Story />
      </PromptState>
    ),
  ],
}

export const WithImageAttachments = {
  decorators: [
    (Story: import("solid-js").Component) => (
      <PromptState
        parts={[
          {
            type: "image",
            id: "img1",
            filename: "screenshot.png",
            mime: "image/png",
            dataUrl:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          },
        ]}
      >
        <Story />
      </PromptState>
    ),
  ],
}

export const WithYolo = {
  decorators: [
    (Story: import("solid-js").Component) => (
      <StoryWrapper permission={{ isAutoAccepting: () => true }}>
        <Story />
      </StoryWrapper>
    ),
  ],
}
