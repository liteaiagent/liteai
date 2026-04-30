/**
 * Default keybindings.
 *
 * Adapted from MVP `keybindings/defaultBindings.ts`.
 * These are the base bindings that ship with the CLI. They can be overridden
 * by user configuration.
 */

import os from "node:os"
import type { KeybindingBlock } from "./types"

// Platform-specific image paste shortcut:
// - Windows: alt+v (ctrl+v is system paste)
// - Other platforms: ctrl+v
const IMAGE_PASTE_KEY = os.platform() === "win32" ? "alt+v" : "ctrl+v"

export const DEFAULT_BINDINGS: KeybindingBlock[] = [
  {
    context: "Global",
    bindings: {
      "ctrl+c": "app:interrupt",
      "ctrl+d": "app:exit",
      "ctrl+l": "app:redraw",
      "ctrl+t": "app:toggleTodos",
      "ctrl+r": "history:search",
      "meta+j": "app:toggleTerminal",
    },
  },
  {
    context: "Chat",
    bindings: {
      escape: "chat:cancel",
      "ctrl+x ctrl+k": "chat:killAgents",
      "meta+p": "chat:modelPicker",
      "meta+t": "chat:thinkingToggle",
      enter: "chat:submit",
      up: "history:previous",
      down: "history:next",
      "ctrl+_": "chat:undo",
      "ctrl+shift+-": "chat:undo",
      "ctrl+x ctrl+e": "chat:externalEditor",
      "ctrl+g": "chat:externalEditor",
      "ctrl+s": "chat:stash",
      [IMAGE_PASTE_KEY]: "chat:imagePaste",
      // LiteAI extensions
      "ctrl+x b": "chat:sidebarToggle",
      "ctrl+x n": "chat:newSession",
      "ctrl+x l": "chat:sessionList",
      "ctrl+x y": "chat:messageCopy",
      "ctrl+x c": "chat:compact",
      "ctrl+x r": "chat:rename",
    },
  },
  {
    context: "Autocomplete",
    bindings: {
      tab: "autocomplete:accept",
      escape: "autocomplete:dismiss",
      up: "autocomplete:previous",
      down: "autocomplete:next",
    },
  },
  {
    context: "Settings",
    bindings: {
      escape: "confirm:no",
      up: "select:previous",
      down: "select:next",
      k: "select:previous",
      j: "select:next",
      "ctrl+p": "select:previous",
      "ctrl+n": "select:next",
      space: "select:accept",
      enter: "settings:close",
      "/": "settings:search",
      r: "settings:retry",
    },
  },
  {
    context: "Confirmation",
    bindings: {
      y: "confirm:yes",
      n: "confirm:no",
      enter: "confirm:yes",
      escape: "confirm:no",
      up: "confirm:previous",
      down: "confirm:next",
      tab: "confirm:nextField",
      space: "confirm:toggle",
      "shift+tab": "confirm:cycleMode",
      "ctrl+e": "confirm:toggleExplanation",
      "ctrl+d": "permission:toggleDebug",
    },
  },
  {
    context: "Tabs",
    bindings: {
      tab: "tabs:next",
      "shift+tab": "tabs:previous",
      right: "tabs:next",
      left: "tabs:previous",
    },
  },
  {
    context: "HistorySearch",
    bindings: {
      "ctrl+r": "historySearch:next",
      escape: "historySearch:accept",
      tab: "historySearch:accept",
      "ctrl+c": "historySearch:cancel",
      enter: "historySearch:execute",
    },
  },
  {
    context: "Task",
    bindings: {
      "ctrl+b": "task:background",
    },
  },
  {
    context: "ThemePicker",
    bindings: {
      "ctrl+t": "theme:toggleSyntaxHighlighting",
    },
  },
  {
    context: "Scroll",
    bindings: {
      pageup: "scroll:pageUp",
      pagedown: "scroll:pageDown",
      "ctrl+home": "scroll:top",
      "ctrl+end": "scroll:bottom",
      "ctrl+shift+c": "selection:copy",
      "cmd+c": "selection:copy",
    },
  },
  {
    context: "Help",
    bindings: {
      escape: "help:dismiss",
    },
  },
  {
    context: "Attachments",
    bindings: {
      right: "attachments:next",
      left: "attachments:previous",
      backspace: "attachments:remove",
      delete: "attachments:remove",
      down: "attachments:exit",
      escape: "attachments:exit",
    },
  },
  {
    context: "Footer",
    bindings: {
      up: "footer:up",
      "ctrl+p": "footer:up",
      down: "footer:down",
      "ctrl+n": "footer:down",
      right: "footer:next",
      left: "footer:previous",
      enter: "footer:openSelected",
      escape: "footer:clearSelection",
    },
  },
  {
    context: "MessageSelector",
    bindings: {
      up: "messageSelector:up",
      down: "messageSelector:down",
      k: "messageSelector:up",
      j: "messageSelector:down",
      "ctrl+p": "messageSelector:up",
      "ctrl+n": "messageSelector:down",
      "ctrl+up": "messageSelector:top",
      "shift+up": "messageSelector:top",
      "meta+up": "messageSelector:top",
      "shift+k": "messageSelector:top",
      "ctrl+down": "messageSelector:bottom",
      "shift+down": "messageSelector:bottom",
      "meta+down": "messageSelector:bottom",
      "shift+j": "messageSelector:bottom",
      enter: "messageSelector:select",
    },
  },
  {
    context: "DiffDialog",
    bindings: {
      escape: "diff:dismiss",
      left: "diff:previousSource",
      right: "diff:nextSource",
      up: "diff:previousFile",
      down: "diff:nextFile",
      enter: "diff:viewDetails",
    },
  },
  {
    context: "ModelPicker",
    bindings: {
      left: "modelPicker:decreaseEffort",
      right: "modelPicker:increaseEffort",
    },
  },
  {
    context: "Select",
    bindings: {
      up: "select:previous",
      down: "select:next",
      j: "select:next",
      k: "select:previous",
      "ctrl+n": "select:next",
      "ctrl+p": "select:previous",
      pageup: "select:pageUp",
      pagedown: "select:pageDown",
      home: "select:home",
      end: "select:end",
      space: "select:toggle",
      "ctrl+d": "select:delete",
      delete: "select:delete",
      "ctrl+r": "select:rename",
      "ctrl+u": "select:update",
      "ctrl+a": "model:providerList",
      "ctrl+f": "model:favoriteToggle",
      enter: "select:accept",
      escape: "select:cancel",
    },
  },
  {
    context: "Plugin",
    bindings: {
      space: "plugin:toggle",
      i: "plugin:install",
    },
  },
]
