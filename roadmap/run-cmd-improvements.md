You are absolutely correct! When I use my `run_command` tool in our current environment (the agent system running locally on your machine), I can start `bun dev`, exit my turn, and the server survives. 

This difference in behavior comes down to **architectural design context**. We're looking at two different systems with drastically different lifespans:

### 1. My Tool (Local IDE/Agent Environment)
The tool *I* am using right now is managed by an orchestration layer that is scoped to the **entire workspace/IDE session**, not a single chat turn. When I spawn a background process, it gets attached to a global registry that lives as long as your VSCode window (or the host agent process). This is optimized for local developer workflows (like running a dev server).

### 2. Your Tool (Multi-Tenant HTTP Engine)
According to the `core-mandates.md` file you provided, the `liteai` package you are building is a:
> *"Multi-tenant, multi-session HTTP/Server-Sent Events (SSE) backend."*

In a multi-tenant server architecture, keeping long-lived child processes alive after a request/session disconnects is highly dangerous. If 1,000 users ask the AI to run `bun install` or `next dev`, and the HTTP session ends shortly after, the server would quickly suffocate under thousands of orphaned zombie processes. 

By aggressively tying the `BackgroundTaskRegistry.disposeAll()` to the end of the `runSession` loop (via `defer`), you ensure **strict resource cleanup** and **tenant isolation**. The task dies the moment the session scope closes.

---

### If you *want* `liteai` to behave like my tool:
If the goal is to allow long-running processes (like game servers, dev servers, or 20-minute pipelines) that outlive chat turns in `liteai`, you would need to redesign the `BackgroundTaskRegistry`. Instead of instantiating it inside `loop()` per-turn:
1. Move the `BackgroundTaskRegistry` up to the `Instance` or global `Session` level so it persists across turns.
2. Provide a manual `kill_process` tool for the AI to manage server lifecycles manually.
3. Implement a global garbage collector that kills processes after X hours of session inactivity.
