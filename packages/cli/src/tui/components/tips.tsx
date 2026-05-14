import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import { useEffect, useMemo, useState } from "react"
import { useTheme } from "../context/theme.tsx"
import { useKeybindingContext } from "../keybindings/keybinding-context.tsx"

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const matches = Array.from(tip.matchAll(regex))

  let lastIndex = 0
  for (const match of matches) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      parts.push({ text: tip.slice(lastIndex, start), highlight: false })
    }
    parts.push({ text: match[1], highlight: true })
    lastIndex = start + match[0].length
  }

  if (lastIndex < tip.length) {
    parts.push({ text: tip.slice(lastIndex), highlight: false })
  }

  return parts
}

export function Tips() {
  const { theme } = useTheme()
  const { getDisplayText } = useKeybindingContext()

  const tips = useMemo(() => {
    return TIPS.map((tip) => {
      return tip.replace(
        /\[([^|]+)\|([^|]+)\|([^\]]+)\]/g,
        (
          // _match is genuinely unused but required by String.prototype.replace callback signature to access capture groups
          _match,
          action,
          context,
          fallback,
        ) => {
          const display = getDisplayText(action, context)
          return `{highlight}${display || fallback}{/highlight}`
        },
      )
    })
  }, [getDisplayText])

  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length))

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => {
        let next: number
        do {
          next = Math.floor(Math.random() * tips.length)
        } while (next === prev && tips.length > 1)
        return next
      })
    }, 30_000)
    return () => clearInterval(interval)
  }, [tips.length])

  const parts = useMemo(() => parse(tips[tipIndex] ?? tips[0]), [tips, tipIndex])

  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text color={theme.warning as Color}>● Tip </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" flexShrink={1}>
        {parts.map((part, i) => (
          <Text key={i} color={(part.highlight ? theme.text : theme.textMuted) as Color}>
            {part.text}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

const TIPS = [
  "Type {highlight}@{/highlight} followed by a filename to fuzzy search and attach files",
  "Start a message with {highlight}!{/highlight} to run shell commands directly (e.g., {highlight}!ls -la{/highlight})",
  "Press {highlight}Tab{/highlight} to cycle between Build and Plan agents",
  "Use {highlight}/undo{/highlight} to revert the last message and file changes",
  "Use {highlight}/redo{/highlight} to restore previously undone messages and file changes",
  "Run {highlight}/share{/highlight} to create a public link to your conversation at liteai.com",
  "Drag and drop images into the terminal to add them as context",
  "Press [chat:imagePaste|Chat|Ctrl+V] to paste images from your clipboard into the prompt",
  "Press [chat:externalEditor|Chat|Ctrl+X E] or {highlight}/editor{/highlight} to compose messages in your external editor",
  "Run {highlight}/init{/highlight} to auto-generate project rules based on your codebase",
  "Run {highlight}/models{/highlight} or [chat:modelPicker|Chat|Ctrl+X M] to see and switch between available AI models",
  "Press [chat:newSession|Chat|Ctrl+X N] or {highlight}/clear{/highlight} to start a fresh conversation session",
  "Use {highlight}/sessions{/highlight} or [chat:sessionList|Chat|Ctrl+X L] to list and continue previous conversations",
  "Run {highlight}/compact{/highlight} to summarize long sessions near context limits",
  "Press {highlight}Ctrl+X X{/highlight} or {highlight}/export{/highlight} to save the conversation as Markdown",
  "Press [chat:messageCopy|Chat|Ctrl+X Y] to copy the assistant's last message to clipboard",
  "Press {highlight}Ctrl+P{/highlight} to see all available actions and commands",
  "Run {highlight}/connect{/highlight} to add API keys for 75+ supported LLM providers",
  "Press {highlight}F2{/highlight} to quickly switch between recently used models",
  "Press [chat:sidebarToggle|Chat|Ctrl+X B] to show/hide the sidebar panel",
  "Use {highlight}PageUp{/highlight}/{highlight}PageDown{/highlight} to navigate through conversation history",
  "Press [scroll:top|Scroll|Ctrl+Home] to jump to the beginning of the conversation",
  "Press [scroll:bottom|Scroll|Ctrl+End] to jump to the most recent message",
  "Press {highlight}Shift+Enter{/highlight} or {highlight}Ctrl+J{/highlight} to add newlines in your prompt",
  "Press {highlight}Ctrl+C{/highlight} when typing to clear the input field",
  "Press [chat:cancel|Chat|Escape] to stop the AI mid-response",
  "Switch to {highlight}Plan{/highlight} agent to get suggestions without making actual changes",
  "Use {highlight}@agent-name{/highlight} in prompts to invoke specialized subagents",
  "Press {highlight}Ctrl+X Right/Left{/highlight} to cycle through parent and child sessions",
  "Create {highlight}liteai.json{/highlight} for server settings and {highlight}tui.json{/highlight} for TUI settings",
  "Place TUI settings in {highlight}~/.config/liteai/tui.json{/highlight} for global config",
  "Add {highlight}$schema{/highlight} to your config for autocomplete in your editor",
  "Configure {highlight}model{/highlight} in config to set your default model",
  "Override any keybind in {highlight}tui.json{/highlight} via the {highlight}keybinds{/highlight} section",
  "Set any keybind to {highlight}none{/highlight} to disable it completely",
  "Configure local or remote MCP servers in the {highlight}mcp{/highlight} config section",
  "LiteAI auto-handles OAuth for remote MCP servers requiring auth",
  "Add {highlight}.md{/highlight} files to {highlight}.liteai/command/{/highlight} to define reusable custom prompts",
  "Use {highlight}$ARGUMENTS{/highlight}, {highlight}$1{/highlight}, {highlight}$2{/highlight} in custom commands for dynamic input",
  "Use backticks in commands to inject shell output (e.g., {highlight}`git status`{/highlight})",
  "Add {highlight}.md{/highlight} files to {highlight}.liteai/agents/{/highlight} for specialized AI personas",
  "Configure per-agent permissions for {highlight}edit{/highlight}, {highlight}bash{/highlight}, and {highlight}webfetch{/highlight} tools",
  'Use patterns like {highlight}"git *": "allow"{/highlight} for granular bash permissions',
  'Set {highlight}"rm -rf *": "deny"{/highlight} to block destructive commands',
  'Configure {highlight}"git push": "ask"{/highlight} to require approval before pushing',
  "LiteAI auto-formats files using biome, gofmt, ruff, and more",
  'Set {highlight}"formatter": false{/highlight} in config to disable all auto-formatting',
  "Define custom formatter commands with file extensions in config",
  "LiteAI uses LSP servers for intelligent code analysis",
  "Create {highlight}.ts{/highlight} files in {highlight}.liteai/tools/{/highlight} to define new LLM tools",
  "Tool definitions can invoke scripts written in Python, Go, etc",
  "Add {highlight}.ts{/highlight} files to {highlight}.liteai/plugin/{/highlight} for event hooks",
  "Use plugins to send OS notifications when sessions complete",
  "Create a plugin to prevent LiteAI from reading sensitive files",
  "Use {highlight}liteai run{/highlight} for non-interactive scripting",
  "Use {highlight}liteai --continue{/highlight} to resume the last session",
  "Use {highlight}liteai run -f file.ts{/highlight} to attach files via CLI",
  "Use {highlight}--format json{/highlight} for machine-readable output in scripts",
  "Run {highlight}liteai serve{/highlight} for headless API access to LiteAI",
  "Use {highlight}liteai run --attach{/highlight} to connect to a running server",
  "Run {highlight}liteai upgrade{/highlight} to update to the latest version",
  "Run {highlight}liteai auth list{/highlight} to see all configured providers",
  "Run {highlight}liteai agent create{/highlight} for guided agent creation",
  "Use {highlight}/liteai{/highlight} in GitHub issues/PRs to trigger AI actions",
  "Run {highlight}liteai github install{/highlight} to set up the GitHub workflow",
  "Comment {highlight}/liteai fix this{/highlight} on issues to auto-create PRs",
  "Comment {highlight}/oc{/highlight} on PR code lines for targeted code reviews",
  'Use {highlight}"theme": "system"{/highlight} to match your terminal\'s colors',
  "Create JSON theme files in {highlight}.liteai/themes/{/highlight} directory",
  "Themes support dark/light variants for both modes",
  "Reference ANSI colors 0-255 in custom themes",
  "Use {highlight}{env:VAR_NAME}{/highlight} syntax to reference environment variables in config",
  "Use {highlight}{file:path}{/highlight} to include file contents in config values",
  "Use {highlight}instructions{/highlight} in config to load additional rules files",
  "Set agent {highlight}temperature{/highlight} from 0.0 (focused) to 1.0 (creative)",
  "Configure {highlight}steps{/highlight} to limit agentic iterations per request",
  'Set {highlight}"tools": {"bash": false}{/highlight} to disable specific tools',
  'Set {highlight}"mcp_*": false{/highlight} to disable all tools from an MCP server',
  "Override global tool settings per agent configuration",
  'Set {highlight}"share": "auto"{/highlight} to automatically share all sessions',
  'Set {highlight}"share": "disabled"{/highlight} to prevent any session sharing',
  "Run {highlight}/unshare{/highlight} to remove a session from public access",
  "Permission {highlight}doom_loop{/highlight} prevents infinite tool call loops",
  "Permission {highlight}external_directory{/highlight} protects files outside project",
  "Run {highlight}liteai debug config{/highlight} to troubleshoot configuration",
  "Use {highlight}--print-logs{/highlight} flag to see detailed logs in stderr",
  "Press {highlight}Ctrl+X G{/highlight} or {highlight}/timeline{/highlight} to jump to specific messages",
  "Press {highlight}Ctrl+X H{/highlight} to toggle code block visibility in messages",
  "Press {highlight}Ctrl+X S{/highlight} or {highlight}/status{/highlight} to see system status info",
  "Use {highlight}/config{/highlight} to open the settings panel — tweak theme, providers, and more",
  "Toggle username display in chat via command palette ({highlight}Ctrl+P{/highlight})",
  "Run {highlight}docker run -it --rm ghcr.io/liteaiagent/liteai{/highlight} for containerized use",
  "Use {highlight}/connect{/highlight} with LiteAI Zen for curated, tested models",
  "Commit your project's {highlight}AGENTS.md{/highlight} file to Git for team sharing",
  "Use {highlight}/review{/highlight} to review uncommitted changes, branches, or PRs",
  "Run {highlight}/help{/highlight} or {highlight}Ctrl+X H{/highlight} to show the help dialog",
  "Use {highlight}/rename{/highlight} to rename the current session",
  "Press {highlight}Ctrl+Z{/highlight} to suspend the terminal and return to your shell",
]
