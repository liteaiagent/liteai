import * as CommandMod from "./command"
import * as Message from "./input"
import * as Loop from "./loop"
import * as ShellMod from "./shell"
import * as Tools from "./tools"

export namespace SessionPrompt {
  export const assertNotBusy = Loop.assertNotBusy
  export const cancel = Loop.cancel
  export const loop = Loop.loop
  export const LoopInput = Loop.LoopInput
  export const prompt = Loop.prompt
  export const runSubagent = Loop.runSubagent
  export const PromptInput = Loop.PromptInput
  export type PromptInput = Loop.PromptInput
  export const resolvePromptParts = Message.resolvePromptParts
  export const resolveTools = Tools.resolveTools
  export const createStructuredOutputTool = Tools.createStructuredOutputTool
  export const shell = ShellMod.shell
  export const ShellInput = ShellMod.ShellInput
  export type ShellInput = ShellMod.ShellInput
  export const command = CommandMod.command
  export const CommandInput = CommandMod.CommandInput
  export type CommandInput = CommandMod.CommandInput
}
