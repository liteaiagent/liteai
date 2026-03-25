// @ts-nocheck

import { create } from "../storybook/scaffold"
import * as mod from "./message-part"

const story = create({ title: "UI/MessagePart", mod })
export default {
  title: "UI/MessagePart",
  id: "components-message-part",
  component: story.meta.component,
}
export const Basic = story.Basic
