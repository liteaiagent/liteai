// @ts-nocheck

import { create } from "../storybook/scaffold"
import * as mod from "./session-review"

const story = create({ title: "UI/SessionReview", mod })
export default {
  title: "UI/SessionReview",
  id: "components-session-review",
  component: story.meta.component,
}
export const Basic = story.Basic
