# MVP Plan Mode: Code Reference Map

> [!WARNING]
> **MVP Reference Only:** This code map points to the legacy **LiteAI CLI MVP** (`liteai_cli_mvp`), **not** the current `liteai` mono-repo core (`packages/core`). 

This document maps the architectural concepts discussed in [MVP Plan Mode Architecture](mvp_plan_mode_architecture.md) directly to their TypeScript implementations in the MVP codebase.

> [!NOTE]
> The paths below are absolute links to your local MVP workspace (`C:\Users\aghassan\Documents\workspace\liteai_cli_mvp`). If you are viewing this in Obsidian, clicking these links will attempt to open the file in your default editor.

## 1. Mode Cycling (`Shift+Tab`)
The state logic that handles cycling between `Default`, `Auto-Accept`, and `Plan Mode` via the `Shift+Tab` keybinding:
- [getNextPermissionMode.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/permissions/getNextPermissionMode.ts)
- [permissionSetup.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/permissions/permissionSetup.ts)

## 2. Proactive Planning (`EnterPlanMode`)
The tool definition and prompt instructions that allow the AI to proactively transition into Plan Mode when faced with a complex request:
- [EnterPlanModeTool.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/tools/EnterPlanModeTool/EnterPlanModeTool.ts)
- [prompt.ts (EnterPlanMode)](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/tools/EnterPlanModeTool/prompt.ts)

## 3. Plan Finalization & State Restoration (`ExitPlanModeV2`)
The tool the AI calls to present the final plan to the user for approval. Handling user rejection (iteration) or approval (state restoration):
- [ExitPlanModeV2Tool.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

## 4. Session Management (`/resume`, `/rename`)
The logic managing named sessions, allowing the user to pick up where they left off without losing context:
- [sessionStorage.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/sessionStorage.ts)
- [sessionRestore.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/sessionRestore.ts)
- [commands/resume/index.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/commands/resume/index.ts)

## 5. Background Agents & Swarms
The implementations for parallel agent execution, the `/tasks` slash command UI, and the Mailbox protocol (`plan_approval_request`) used by subagents:
- **Background Tasks UI**: [tasks.tsx](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/commands/tasks/tasks.tsx)
- **Subagent Mailbox**: [teammateMailbox.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/utils/teammateMailbox.ts)
- **Explore Subagent (Swarms)**: [exploreAgent.ts](file:///C:/Users/aghassan/Documents/workspace/liteai_cli_mvp/tools/AgentTool/built-in/exploreAgent.ts)
