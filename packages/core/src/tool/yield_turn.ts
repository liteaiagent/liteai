import z from "zod"
import DESCRIPTION from "../bundled/prompts/tools/yield_turn.txt"
import { Tool } from "./tool"

export const YieldTurnTool = Tool.define("yield_turn", {
  description: DESCRIPTION,
  parameters: z.object({
    summary: z
      .string()
      .describe("A brief summary of what you accomplished or observed. This text is displayed to the user."),
  }),
  async execute(params, _ctx) {
    return {
      title: "Turn complete",
      output: params.summary,
      metadata: { terminal: true },
    }
  },
})
