# LiteAI CLI: Workflows & Plan Mode Guide

> [!WARNING]
> **MVP Reference Only:** This guide documents the workflows and features of the **legacy LiteAI CLI MVP** (`liteai_cli_mvp`), **not** the current `liteai` mono-repo core (`packages/core`). 

This guide is inspired by the "Claude Code for Everything" philosophy. Whether you're writing code, drafting articles, or doing research, this document outlines the fundamental workflows to get the best out of LiteAI CLI MVP. 

> [!NOTE]
> For a deep dive into the underlying architecture and how these modes are implemented under the hood, refer to [MVP Plan Mode Architecture](mvp_plan_mode_architecture.md).

## 1. The Core Workflow: The Three Modes

LiteAI CLI has three modes that control how much autonomy the AI has. The core philosophy is to **match your level of oversight to your confidence in the output**.

You can cycle through these modes at any time by pressing `Shift+Tab` from the input line:

- **Plan Mode**: The AI explores and plans but doesn't execute any state-changing terminal commands or write any files (other than the plan file). Use this for big decisions or new tasks where you need to align on the approach first.
- **Default Mode**: The AI asks permission before each edit or potentially dangerous command. Use this when executing a plan where you want to review and approve every change.
- **Auto-Accept (Allow) Mode**: The AI executes file changes without asking. It will still ask for permission before running dangerous terminal commands. Use this for simple, mechanical tasks you are confident about.

> [!TIP]
> Start in Plan mode to align on the approach. Switch to Default mode to execute with review. Flip to Auto-Accept for trusted stretches. Then back to Plan mode when you hit a new decision point.

### AI-Initiated Plan Mode (Proactive Planning)

Unlike some other agents, **LiteAI CLI can proactively switch to Plan Mode on its own**. 
If you are in *Default* or *Auto-Accept* mode and give the AI a massive, complex request (e.g., "Refactor the entire authentication system"), the AI realizes it's too complex to jump right in. Because the `EnterPlanMode` tool is available to the AI across **all** standard modes, it will proactively pause and prompt you:

*"Approve entering plan mode? The agent will explore the codebase and design an implementation plan before writing any code."*

If you approve, it safely transitions into Plan Mode to map out the work.

---

## 2. Parallel Sessions (For Unrelated Tasks / Different Plans)

Treat each session like assigning a task to a dedicated teammate. If you try to do too many **unrelated** things in one session (e.g., refactoring auth *and* writing a blog post), the AI loses focus and context gets muddied. To solve this, you use parallel sessions:

- **Run parallel sessions**: Open a second terminal instance and start a fresh `liteai` session. Now you have two sessions working on two completely independent plans, with zero shared context.
- **Name your sessions**: Use the `/rename [name]` slash command so you can easily identify them later.
- **Resume later**: Use the `/resume` slash command to browse your named sessions and pick up exactly where you left off, with all context intact. You can also start the CLI directly into a session using `liteai --resume [name]`.

---

## 3. Background Agents & Swarms (For Related Work / Same Plan)

Unlike parallel sessions, background agents are used when you want to **parallelize work for your *current* plan** without blocking your terminal. For example, if your plan requires reading through 50 files to map dependencies, doing that in the foreground blocks you from doing anything else.

- **Background Tasks**: You can tell the AI to run something in the background (e.g., "Compile all the sources we've referenced into a bibliography - do this in the background"). You stay in one session, but the AI spawns a subagent to handle this chunk of work.
- **Monitoring**: Check on running background tasks by typing the `/tasks` slash command.
- **Subagent Handoff (The Mailbox)**: In LiteAI CLI, background agents don't aggressively interrupt your flow. Instead, they complete their assigned chunk of the plan and submit a silent `plan_approval_request` to the "Team Lead mailbox". The main agent can review this mailbox when you're ready to compile the final architecture.
- **Swarms**: For massive codebases, LiteAI CLI can spawn multiple "Explore Subagents" to read directories in parallel. They work simultaneously under the hood to finish the singular plan faster.

---

## 4. Advanced Customization

Once you've nailed the fundamentals, you can automate repetitive tasks:

- **Slash Commands**: LiteAI comes with a rich set of built-in commands (`/help`, `/mcp`, `/tasks`, `/rename`, etc.) to speed up your workflow.
- **MCP (Model Context Protocol)**: Connect the CLI to external apps using the `/mcp` command, allowing the AI to pull context directly from your broader ecosystem.

---

## 5. IDE & Workspace Best Practices

While LiteAI is a CLI tool, it shines brightest when paired with a good IDE setup (like Cursor or VS Code):

- **Split your editor**: When the AI generates a markdown plan, open the raw markdown on the left and the Preview on the right. This lets you read the nicely formatted preview while making quick edits to the raw file.
- **Table of contents**: Ask the AI to add a clickable table of contents to long markdown files so you can easily jump around in Preview mode.
- **PDF Extension**: Install extensions like `vscode-pdf` to view reference documents right inside your IDE alongside the AI's terminal.

---

## Capability Matrix: LiteAI vs Claude Code

Here is a quick reference comparing the standard "Claude Code" workflow philosophy to LiteAI CLI's implementation:

| Feature | Supported in LiteAI? | Notes / Enhancements |
| :--- | :--- | :--- |
| **The Three Modes** | ✅ Yes | Toggled via `Shift+Tab`. |
| **Proactive Plan Mode** | ✅ Yes | **LiteAI Enhancement**: AI can proactively enter Plan Mode from *any* mode if the prompt is too complex. |
| **Parallel Sessions** | ✅ Yes | Run multiple terminal instances. |
| **Session Resumption** | ✅ Yes | `/rename`, `/resume`, and `--resume` are fully supported. |
| **Background Tasks** | ✅ Yes | Use `/tasks`. |
| **Subagent Mailbox** | ✅ Yes | **LiteAI Enhancement**: Background subagents submit plans silently to the main agent's mailbox to avoid interrupting the user. |
| **Swarms (Parallel Explore)**| ✅ Yes | **LiteAI Enhancement**: AI can spin up multiple parallel agents to explore large codebases simultaneously. |
| **Interview Mode** | ✅ Yes | **LiteAI Enhancement**: Optional Plan Mode feature where the AI interviews the user step-by-step instead of exploring silently. |
| **MCP Integrations** | ✅ Yes | Supported via the `/mcp` command. |
