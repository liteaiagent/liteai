# Phase 7B — Agent Management UI

> Full agent CRUD experience: list, detail, create, edit (7.3)

---

## Prerequisites
- Phase 6B complete (dialog infrastructure, `DialogSelect`, `dialog.push()`/`dialog.pop()`)
- Existing: `dialog-agent.tsx` (34 lines — bare-bones select), `useLocal().agent`, `Agent.Info` schema

## Remote-Mode Constraint
- Agent listing: already served via `GET /agent` → `Agent.list()`. CLI reads from sync context (`sync.agent`).
- Agent creation/editing: requires a **new core API endpoint** (`POST /agent`, `PUT /agent/:name`) that writes `.liteai/agents/<name>.md` server-side. CLI must NOT do filesystem writes for agents because the server may be remote.
- Agent deletion: requires `DELETE /agent/:name` core endpoint.

---

## Core API Additions

### New Route File
**File [NEW]:** `packages/core/src/server/routes/agent.ts`

```ts
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Agent } from "../../agent/agent"
import { AgentWriter } from "../../agent/writer"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const AgentRoutes = lazy(() =>
  new Hono()
    .get(
      "/:name",
      describeRoute({
        summary: "Get agent detail",
        operationId: "project.agent.get",
        responses: {
          200: {
            description: "Agent detail",
            content: { "application/json": { schema: resolver(Agent.Info) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const agent = await Agent.get(c.req.valid("param").name)
        if (!agent) return c.json({ error: "Agent not found" }, 404)
        return c.json(agent)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create agent",
        operationId: "project.agent.create",
        responses: {
          200: { description: "Created", content: { "application/json": { schema: resolver(Agent.Info) } } },
          ...errors(400, 409),
        },
      }),
      validator("json", AgentWriter.CreateSchema),
      async (c) => {
        const body = c.req.valid("json")
        const info = await AgentWriter.create(body)
        return c.json(info)
      },
    )
    .put(
      "/:name",
      describeRoute({
        summary: "Update agent",
        operationId: "project.agent.update",
        responses: {
          200: { description: "Updated", content: { "application/json": { schema: resolver(Agent.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("json", AgentWriter.UpdateSchema),
      async (c) => {
        const name = c.req.valid("param").name
        const body = c.req.valid("json")
        const info = await AgentWriter.update(name, body)
        return c.json(info)
      },
    )
    .delete(
      "/:name",
      describeRoute({
        summary: "Delete agent",
        operationId: "project.agent.delete",
        responses: {
          200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const name = c.req.valid("param").name
        await AgentWriter.remove(name)
        return c.json(true)
      },
    ),
)
```

### Agent Writer Module
**File [NEW]:** `packages/core/src/agent/writer.ts`

Handles serialization of agent definitions to `.md` files with YAML frontmatter.

```ts
import path from "node:path"
import { Fs as Filesystem } from "@liteai/util/fs"
import matter from "gray-matter"
import z from "zod"
import { Bus } from "@/bus"
import { Instance } from "../project/instance"
import { Brand } from "../brand"
import { Agent } from "./agent"

export namespace AgentWriter {
  export const CreateSchema = z.object({
    name: z.string().regex(/^[a-z0-9_-]+$/, "Agent name must be lowercase alphanumeric with hyphens/underscores"),
    description: z.string(),
    prompt: z.string(),
    model: z.string().optional(),
    tools: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    permissionMode: z.enum(["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan", "bubble"]).optional(),
    temperature: z.number().optional(),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
  })
  export type CreateInput = z.infer<typeof CreateSchema>

  export const UpdateSchema = CreateSchema.partial().omit({ name: true })
  export type UpdateInput = z.infer<typeof UpdateSchema>

  function agentDir(): string {
    return path.join(Instance.directory, Brand.dir, "agents")
  }

  function agentPath(name: string): string {
    return path.join(agentDir(), `${name}.md`)
  }

  export async function create(input: CreateInput): Promise<Agent.Info> {
    const existing = await Agent.get(input.name).catch(() => null)
    if (existing) throw new Error(`Agent '${input.name}' already exists`)

    const { prompt, name, ...frontmatter } = input
    const content = matter.stringify(prompt ?? "", frontmatter)

    await Filesystem.mkdir(agentDir(), { recursive: true })
    await Filesystem.write(agentPath(name), content)

    // Reload agents
    await Agent.reload()
    const agent = await Agent.get(name)
    if (!agent) throw new Error("Failed to create agent")
    return agent
  }

  export async function update(name: string, input: UpdateInput): Promise<Agent.Info> {
    const filePath = agentPath(name)
    const exists = await Filesystem.exists(filePath)
    if (!exists) throw new Error(`Agent file not found: ${name}`)

    const raw = await Filesystem.read(filePath)
    const { data, content } = matter(raw)

    const merged = { ...data, ...input }
    const newPrompt = input.prompt ?? content
    const { prompt: _prompt, ...frontmatter } = merged
    const newContent = matter.stringify(newPrompt, frontmatter)

    await Filesystem.write(filePath, newContent)
    await Agent.reload()

    const agent = await Agent.get(name)
    if (!agent) throw new Error("Failed to update agent")
    return agent
  }

  export async function remove(name: string): Promise<void> {
    const agent = await Agent.get(name)
    if (!agent) throw new Error(`Agent not found: ${name}`)
    if (agent.native) throw new Error("Cannot delete built-in agent")

    const filePath = agentPath(name)
    await Filesystem.remove(filePath)
    await Agent.reload()
  }
}
```

### Agent Reload Support
**File:** `packages/core/src/agent/agent.ts`

Add a `reload()` export that invalidates the `Instance.state()` cache and re-publishes agent list via Bus:

```ts
export async function reload() {
  state.invalidate()
  const agents = await list()
  Bus.publish(Agent.Event.Updated, { agents })
}

// Add Bus event for agent list changes
export const Event = {
  Updated: BusEvent.define(
    "agent.updated",
    z.object({ agents: Agent.Info.array() }),
  ),
}
```

### Route Registration
**File:** `packages/core/src/server/routes/instance.ts`

Mount the new agent routes alongside the existing `GET /agent` listing. The existing `/agent` GET stays in `instance.ts`; CRUD operations use the new sub-router:

In the main router composition file, mount:
```ts
.route("/agent", AgentRoutes())
```

---

## CLI Dialog Components

### 1. Agent List Dialog (replaces `dialog-agent.tsx`)
**File [MODIFY]:** `packages/cli/src/tui/components/dialog-agent.tsx` → rename to `dialog-agent-list.tsx`

**Architecture:**
- Uses `DialogSelect` for the agent list
- Groups by source: "Built-in" section (dimmed), "Custom" section (selectable)
- Each option shows: `name · model · tool count`
- Footer actions: `Enter select · ctrl+d delete · ctrl+n create`

```tsx
// Key data flow:
const agents = useLocal().agent.list()
const grouped = useMemo(() => ({
  native: agents.filter(a => a.native),
  custom: agents.filter(a => !a.native && !a.hidden),
}), [agents])

// On select → dialog.push(<DialogAgentDetail agent={selected} />)
// On ctrl+n → dialog.push(<DialogAgentEditor />)
// On ctrl+d → sdk.client.project.agent.delete({ name }) + toast
```

### 2. Agent Detail Dialog
**File [NEW]:** `packages/cli/src/tui/components/dialog-agent-detail.tsx`

**Architecture:**
- Read-only view showing all agent properties
- Fields rendered: name, description, mode, model, tools, permissionMode, temperature, prompt (first 10 lines + truncation)
- Footer: `Enter edit · Esc back`
- "Edit" only available for non-native agents

```tsx
export function DialogAgentDetail({ agent }: { agent: Agent }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  // Renders agent properties as labeled rows
  // On Enter → dialog.push(<DialogAgentEditor agent={agent} />)
}
```

### 3. Agent Editor Dialog
**File [NEW]:** `packages/cli/src/tui/components/dialog-agent-editor.tsx`

**Architecture:**
- Form-based editor using `TextInput` for fields
- Fields: name (create only), description, prompt (opens external editor via `$EDITOR`), model (opens model picker dialog)
- Save: calls `POST /agent` (create) or `PUT /agent/:name` (update) via SDK
- Cancel: `Esc` pops dialog

```tsx
export function DialogAgentEditor({ agent }: { agent?: Agent }) {
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const isNew = !agent

  const [form, setForm] = useState({
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    prompt: agent?.prompt ?? "",
    mode: agent?.mode ?? "all",
  })

  async function save() {
    if (isNew) {
      await sdk.client.project.agent.create({ json: form })
    } else {
      await sdk.client.project.agent.update({
        param: { name: agent.name },
        json: form,
      })
    }
    toast.show({ variant: "success", message: `Agent ${isNew ? "created" : "updated"}` })
    dialog.clear()
  }
}
```

### 4. SDK Client Extension
**File:** `packages/sdk/src/client.ts` (or wherever the HTTP client is defined)

Add agent CRUD methods:
```ts
agent: {
  get: (params: { name: string }) => GET(`/agent/${params.name}`),
  create: (body: AgentCreateInput) => POST("/agent", body),
  update: (params: { name: string }, body: AgentUpdateInput) => PUT(`/agent/${params.name}`, body),
  delete: (params: { name: string }) => DELETE(`/agent/${params.name}`),
}
```

### 5. Slash Command Registration
**File:** `packages/cli/src/tui/commands/` (or wherever slash commands are registered)

Register `/agents` command that opens `DialogAgentList`:
```ts
{ name: "agents", description: "Manage agents", action: () => dialog.push(<DialogAgentList />) }
```

### 6. Keybinding Registration
Add `ctrl+x a` in Chat context → opens agent management dialog.

---

## Files Changed Summary

| File | Action | Package | Notes |
|---|---|---|---|
| `core/src/agent/writer.ts` | NEW | core | Agent CRUD file I/O |
| `core/src/agent/agent.ts` | MODIFY | core | Add `reload()`, `Event.Updated` |
| `core/src/server/routes/agent.ts` | NEW | core | REST endpoints |
| `core/src/server/routes/instance.ts` | MODIFY | core | Mount agent routes |
| `sdk/src/client.ts` | MODIFY | sdk | Add agent CRUD methods |
| `cli/src/tui/components/dialog-agent-list.tsx` | NEW (replace) | cli | Agent list with grouping |
| `cli/src/tui/components/dialog-agent-detail.tsx` | NEW | cli | Read-only agent detail |
| `cli/src/tui/components/dialog-agent-editor.tsx` | NEW | cli | Create/edit form |
| Slash command + keybinding registration files | MODIFY | cli | `/agents` + `ctrl+x a` |

## Verification
1. `bun typecheck` in `packages/core`, `packages/sdk`, `packages/cli`
2. `bun lint:fix` across all three
3. `bun test test/agent` scoped to agent domain
4. Manual test: create agent via dialog → verify `.liteai/agents/<name>.md` written
5. Manual test: edit agent → verify file updated, agent list refreshed
6. Manual test: delete custom agent → verify file removed, list updated
7. Manual test: attempt to delete built-in agent → verify error toast
