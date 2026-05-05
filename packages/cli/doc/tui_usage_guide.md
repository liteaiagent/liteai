# LiteAI CLI User Guide

Welcome to the LiteAI Terminal User Interface (TUI). This guide covers the extensive feature set available in the CLI, designed to help you manage sessions, navigate conversations, and orchestrate agentic workflows efficiently right from your terminal.

## 1. Session Management

LiteAI supports a robust multi-session environment, allowing you to seamlessly context-switch between different tasks.

- **Session List & Creation:** Access your session roster to create new sessions or resume past ones.
- **Multi-Session Tabs:** Manage multiple active sessions simultaneously using the tabbed interface.
- **Session Actions:** Keep your workspace organized by **Renaming**, **Tagging**, and **Archiving** sessions.
- **Session Branching:** Branch off from a specific point in a past session to explore alternative implementation paths without destroying the original context.

## 2. Prompting & Conversation

The prompt input is built for power users, offering rich features beyond basic text entry.

- **Rich Input & Vim Mode:** Standard text input is supported alongside an optional Vim keybinding mode for rapid editing.
- **@ Completions:** Type `@` to instantly trigger intelligent autocompletion for workspace files and symbols.
- **Slash Commands:** Type `/` to access a suite of built-in commands for quick actions (e.g., compaction, settings).
- **History & Search:** Navigate your prompt history using the Up/Down arrow keys, or use the dedicated history search to find past queries.
- **External Editor (`editor`):** For massive prompts or complex code pasting, open your default external editor directly from the input box.

### Message Handling
- **Real-time Streaming:** Agent responses, thinking processes, and tool execution streams are rendered in real-time.
- **Message Actions:** Easily **Copy** message content, **Retry** failed turns, or **Edit** past messages to alter the course of the conversation.
- **Message Queueing:** The TUI features a non-blocking prompt—you can queue up new prompts while the agent is currently busy processing previous tasks.

## 3. Display Density & UI Modes

Customize the verbosity of the interface to match your workflow.

- **Mode Toggle (`Ctrl+O`):** Toggle effortlessly between **Compact Mode** (which hides verbose tool outputs and intermediate steps) and **Transcript Mode** (which displays the full, unadulterated execution logs).
- **Collapsed Groups:** Tool calls and repetitive subagent loops are grouped and collapsed by default to save vertical space.
- **Inline Diffs:** File modifications are visualized clearly as inline structured diffs.
- **Thinking Indicator:** The agent's internal reasoning is displayed with a clean thinking title (derived from a first-sentence heuristic) and can be toggled on or off to reduce noise.

## 4. Context & Token Management

Stay informed about your context window usage and associated costs.

- **Status Line:** The persistent bottom status line displays your active model, context usage percentage, and current session cost.
- **Token Tracking:** Access detailed breakdowns of your context window and receive token warnings as you approach the model's limits.
- **Context Compaction:** When the context limit approaches, the system can auto-compact the history, or you can trigger a manual compaction via a slash command. The UI replaces the compacted history with a concise summary, though you can always "Show All" to view the original transcript.

## 5. Time Travel & Rewind

Mistakes happen. LiteAI provides fine-grained control over the session timeline.

- **Turn Navigation:** Review past turns and inspect the exact diff stats for each step taken.
- **Restore Options:** Use the rewind dialog to roll the session back to a previous state, discarding subsequent turns or branching off into a new session.

## 6. Search Capabilities

Find what you need across your current workspace and historical data.

- **Transcript Search:** Instantly search within the active session.
- **Workspace Search:** Find files and symbols across your local project directory.
- **Cross-Session Search:** Perform full-text searches (FTS) across all your historical, archived, and active sessions.

## 7. Settings & Configuration

Tailor the CLI's behavior without modifying config files manually.

- **Model & Provider Selection:** Easily switch between AI models (e.g., Gemini, Claude, GPT) and their respective providers via interactive dialogs.
- **Appearance:** Change the theme and terminal output styles.
- **Permissions:** Adjust what the agent can execute autonomously (e.g., shell commands, file writes) via the permissions dialog and monitor the current permission mode on the status line.
- **Diagnostics:** Access the built-in doctor/diagnostics dashboard to troubleshoot environment issues or adjust the agent's effort levels.

## 8. MCP & Agent Extensions

Leverage advanced agentic capabilities directly from the CLI.

- **MCP Servers:** View and manage connected Model Context Protocol (MCP) servers to extend the agent's context.
- **Agent Roster:** Inspect and configure available specialized subagents.
- **Memory Management:** View and curate the agent's long-term memory banks.

---
*This guide reflects the features available in the current LiteAI TUI release. Use the built-in help system (`/help` or via dialog) for keyboard shortcuts and immediate assistance.*
