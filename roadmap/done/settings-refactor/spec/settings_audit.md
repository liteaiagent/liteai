# Settings API Audit — Full Endpoint Inventory

## What Is a "Settings" Endpoint?

For this audit: any endpoint that **reads or mutates persistent configuration** (not just in-memory state).

---

## Tier 1: Global Routes (no project context, mounted at server root)

| Endpoint | Storage | Effect | Can do remotely? |
|---|---|---|---|
| `GET /config` | `~/.liteai/settings.json` | Read global config | ✅ YES |
| `PATCH /config` | `~/.liteai/settings.json` | Write global config (deep merge) | ✅ YES |
| `GET /telemetry` | env var + settings.json | Read telemetry on/off status | ✅ YES |
| `PATCH /telemetry` | settings.json + process.env | Toggle telemetry, write to config | ✅ YES |

## Tier 1: Provider / Auth (server root)

| Endpoint | Storage | Effect | Can do remotely? |
|---|---|---|---|
| `GET /provider` | models.dev + auth.json | List all providers + connected | ✅ YES |
| `GET /provider/auth` | auth.json | List auth methods per provider | ✅ YES |
| `POST /provider/:id/oauth/authorize` | auth.json | Start OAuth flow | ✅ YES |
| `POST /provider/:id/oauth/callback` | auth.json | Complete OAuth, resets state | ✅ YES |
| `PUT /auth/:providerID` | auth.json | Set API key credentials | ✅ YES |
| `DELETE /auth/:providerID` | auth.json | Remove credentials | ✅ YES |

## Tier 2: Project-Scoped Routes (under `/project/:id/...`)

| Endpoint | Storage | Effect | Can do remotely? |
|---|---|---|---|
| `GET /project/:id/config` | `<project>/settings.json` | Read project config | ✅ YES |
| `PATCH /project/:id/config` | `<project>/settings.json` | Write project config (deep merge) | ✅ YES |
| `GET /project/:id/config/providers` | settings.json + models.dev | List providers with defaults | ✅ YES |
| `POST /project/:id/mcp` | in-memory only (NOT persisted!) | Add + connect MCP server | ⚠️ PARTIAL |
| `POST /project/:id/mcp/:name/connect` | in-memory only | Connect existing MCP server | ⚠️ NOT PERSISTED |
| `POST /project/:id/mcp/:name/disconnect` | in-memory only | Disconnect MCP server | ⚠️ NOT PERSISTED |
| `POST /project/:id/plugin/:id/enable` | settings.json via registry | Enable plugin, writes to settings | ✅ YES |
| `POST /project/:id/plugin/:id/disable` | settings.json via registry | Disable plugin, writes to settings | ✅ YES |
| `DELETE /project/:id/plugin/:id` | settings.json via registry | Uninstall plugin | ✅ YES |

---

## Critical Findings

### 🔴 Finding 1: MCP connect/disconnect is NOT persisted

`POST /project/:id/mcp/:name/connect` and `disconnect` only change **in-memory state**. They do NOT write `{ enabled: true/false }` back to `settings.json`.

- If you disconnect an MCP server via API and restart, it reconnects.
- `POST /project/:id/mcp` (add) also only adds to in-memory state — the config entry is NOT saved.

**Contrast:** Plugin enable/disable DOES persist via `Config.updateGlobal({ enabledPlugins: { [id]: true/false } })`.

### 🟡 Finding 2: PATCH /config is an escape hatch that covers everything

`PATCH /config` accepts the entire `Config.Info` schema as a deep merge, which means:
- You CAN manage MCP server config via `PATCH /config { mcp: { myServer: { type: "local", command: [...] } } }`
- You CAN manage plugin `enabledPlugins` via `PATCH /config { enabledPlugins: { "plugin-id": true } }`
- You CAN manage agents, providers (config block), permissions, compaction, etc.

But this is not surfaced or documented as "the way" to do it — the specialized endpoints (MCP, plugin) exist for operational tasks (connect/disconnect at runtime), not configuration management.

### 🟡 Finding 3: Telemetry toggle is a special case of PATCH /config

`PATCH /telemetry { enabled: true }` does exactly `Config.updateGlobal({ telemetry: { disabled: false } })`.
It's a convenience wrapper around PATCH /config, nothing more.

### 🔴 Finding 4: Server-side env vars have no API at all

The following settings are **env-var-only** and completely unmanageable via API:
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL`
- `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_EXPORTER_OTLP_*`
- `OTEL_METRIC_EXPORT_INTERVAL`, `OTEL_LOGS_EXPORT_INTERVAL`
- `LITEAI_PERFETTO_TRACE`
- `LITEAI_SERVER_CSRF_TOKEN`, `LITEAI_HOME`, etc.

---

## Design Questions to Answer

### Q1: Should MCP connect/disconnect be persisted?

**Option A — Yes, persist enabled flag:**
`MCP.connect(name)` also writes `{ mcp: { [name]: { enabled: true } } }` to project settings.json.
`MCP.disconnect(name)` writes `{ mcp: { [name]: { enabled: false } } }`.

This makes connect/disconnect permanent across restarts.

**Option B — Keep operational separation:**
Connect/disconnect = runtime toggle (in-memory only, transient).
If you want permanent change, use `PATCH /config`.

The existing plugin pattern (`enable`/`disable`) uses Option A. For consistency, MCP should too.

### Q2: What is the right way to add a new MCP server remotely?

Currently `POST /project/:id/mcp` adds to in-memory only. If a remote user adds an MCP server, it disappears on restart. Options:

**Option A — Fix POST /mcp to also persist:**
`MCP.add()` should write to `settings.json` in addition to connecting in-memory.

**Option B — Tell user to PATCH /config instead:**
Remove the add endpoint ambiguity by making `/mcp` purely operational and directing config edits to `/config`.

### Q3: Should we add a `/server-config` or fix `/config`?

**Option A — New `/server-config` endpoint:**
Stores Langfuse/OTEL credentials in a separate `server-config.json`. 
Pros: clean separation of server-side vs project config.
Cons: yet another settings surface; more duplication.

**Option B — Extend `Config.Info` schema:**
Add a `telemetry.langfuse.*` block to the existing schema (alongside the existing `telemetry.disabled`). 
Store credentials in the existing `settings.json`. Load them in `instrumentation.ts`.
Pros: one schema, one file, no API duplication.
Cons: leaks server-side credentials into project-scoped config reads.

**Option C — Hybrid per concern:**
- Langfuse/OTEL credentials → extend `Config.Info.telemetry.*` (global only, not project-scoped)
- Log level → already in `Config.Info.logLevel`
- PATCH /config works as-is

---

## Recommendation

### What to keep as-is
- `GET/PATCH /config` — already correct and powerful enough for all file-based settings
- `GET/PATCH /telemetry` — convenience wrapper, fine to keep
- Provider/auth endpoints — correctly separate (credentials vs config)
- Plugin enable/disable — correctly persists

### What to fix (before adding new things)

1. **Fix MCP persistence** — `MCP.connect()` / `MCP.disconnect()` / `MCP.add()` should persist `enabled` state to `settings.json` (same as plugin enable/disable). This closes the biggest gap with no new endpoints.

2. **Extend `Config.Info.telemetry` schema** — add Langfuse and OTEL fields directly to the existing telemetry block in schema.ts. Then `PATCH /config { telemetry: { langfusePublicKey: "...", langfuseBaseUrl: "..." } }` just works. Load in `instrumentation.ts` by merging config into env before running. No new storage, no new endpoint.

3. **Add a "Server" tab to the web settings dialog** — reading from `GET /config` and writing to `PATCH /config`. No new API surface needed.

### What NOT to do
- Do NOT add a separate `/server-config` endpoint
- Do NOT create a new `server-config.json` file
- Do NOT create `PATCH /settings/env` — writing raw env vars via API is fragile and bypasses Zod validation

---

## Revised Implementation Phases (Minimal, Clean)

| Phase | Change | Files |
|---|---|---|
| **1** | Extend `Config.Info.telemetry` schema with Langfuse/OTEL fields | `schema.ts` |
| **2** | Load telemetry config fields in `instrumentation.ts` before applying env vars | `instrumentation.ts`, `main.ts` |
| **3** | Fix MCP persistence: connect/disconnect/add write `enabled` to settings | `mcp/index.ts` |
| **4** | Add web "Server Config" tab reading/writing `PATCH /config` | `settings-server.tsx`, `dialog-settings.tsx` |
| **5** | (Optional) Remove the now-redundant `PATCH /telemetry` convenience endpoint, or keep for backward compat | `global.ts` |
