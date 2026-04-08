# Settings System Refactor — Specification

> **Status:** Draft v1.0 — 2026-04-06  
> **Scope:** Full refactor of how LiteAI reads, writes, and exposes configuration  
> **Branch:** `settings-refactor` (multi-day effort, phased delivery)

---

## 1. Problem Statement

LiteAI currently manages configuration through three fragmented systems:

| System | Mechanism | Problem |
|---|---|---|
| Core settings | `settings.json` + `PATCH /config` | Works, but incomplete — telemetry, server credentials live outside it |
| Telemetry config | Env vars only (`LANGFUSE_*`, `OTEL_*`) | Cannot be changed at runtime, not remotely manageable |
| MCP state | In-memory only for connect/disconnect | Transient — lost on restart |
| Plugin state | Correctly persisted via config | ✅ Already correct |
| Telemetry toggle | `GET/PATCH /telemetry` wrapper + env var mutation | Redundant; env var mutation in a handler is fragile |

The result: a remote operator cannot fully manage LiteAI via API. The user must SSH into the server, edit `.env` files, and restart.

---

## 2. Goals

1. **Single source of truth**: All non-secret, non-identity settings live in the `Config` system (global `settings.json` and project `settings.json`). Any change goes through the config JSON → filesystem flush pipeline.
2. **No settings in env vars**: Env vars are demoted to *feature flags* (enable/disable behavior) and *path overrides*. They no longer hold settings values (credentials, intervals, export targets, etc.).
3. **Single `/config` endpoint**: All configuration reads and writes go through `GET/PATCH /config` (global) and `GET/PATCH /project/:id/config` (project). Specialized settings sub-endpoints (telemetry, plugin enable/disable) become convenience thin wrappers or are removed.
4. **Sensitive field handling**: Credential fields (Langfuse secret key) are write-accepted but read-redacted in API responses. They are never echoed back.
5. **MCP persistence**: connect/disconnect/add operations persist their state to config so restarts honour the last known intent.

---

## 3. Out of Scope (intentionally unchanged)

These systems have their own storage and identity concerns and are NOT touched by this refactor:

| System | Storage | Reason to leave alone |
|---|---|---|
| Auth / credentials | `~/.local/share/liteai/auth.json` | Identity, OAuth tokens — separate security surface |
| Provider registry | `~/.local/state/liteai/model.json` | Models.dev-sourced, provider-managed |
| UI preferences | `~/.local/state/liteai/kv.json` | Client-side KV store, shared by Web + VS Code |

---

## 4. Config Architecture (Target State)

### 4.1 File Layout

```
~/.liteai/
  settings.json          ← Global config (server-tier + shared defaults)
  config.schema.json     ← Generated JSON schema for editor support

<project>/
  settings.json          ← Project config (overrides global, project-scoped)
```

> **Note on naming**: Files keep the existing `settings.json` name for backward compatibility. The schema type is `Config.Info`. No file renames in Phase 1.

### 4.2 Config Tiers

```
┌──────────────────────────────── Managed Config (enterprise) ─┐
│  /etc/liteai/settings.json   (highest priority, admin-only)   │
└──────────────────────────────────────────────────────────────┘
          ↓ overrides
┌──────────────────────────────── Project Config ───────────────┐
│  <project>/settings.json                                       │
│  <project>/.liteai/settings.json                               │
└──────────────────────────────────────────────────────────────┘
          ↓ overrides
┌──────────────────────────────── Global Config ────────────────┐
│  ~/.liteai/settings.json                                       │
│  (includes telemetry, server, shared MCP, global agents)       │
└──────────────────────────────────────────────────────────────┘
          ↓ overrides
┌──────────────────────────────── Remote Well-Known ────────────┐
│  org-default config                                            │
└──────────────────────────────────────────────────────────────┘
```

**Scope rules:**
- `telemetry.*` — **global-only**. Ignored if present in project config. Rationale: telemetry credentials must not be project-controlled for security.
- `server.*` — **global-only**. Port/hostname are server-scoped.
- All other fields — inheritable from global into project (existing behaviour).

### 4.3 New Schema Additions

The `Config.Info` Zod schema in `schema.ts` gains:

#### `telemetry` block (extended)

```typescript
telemetry: z.object({
  // Existing
  disabled: z.boolean().optional(),

  // New: Langfuse credentials (global-only, secretKey is write-only via API)
  langfuse: z.object({
    publicKey: z.string().optional(),
    secretKey: z.string().optional(),   // ⚠ redacted in GET responses
    baseUrl: z.string().url().optional().default("https://cloud.langfuse.com"),
  }).optional(),

  // New: OpenTelemetry OTLP exporter settings (global-only)
  otel: z.object({
    endpoint: z.string().url().optional(),          // OTEL_EXPORTER_OTLP_ENDPOINT
    protocol: z.enum(["grpc", "http/protobuf", "http/json"]).optional(),
    tracesExporter: z.string().optional(),          // OTEL_TRACES_EXPORTER
    metricsExporter: z.string().optional(),         // OTEL_METRICS_EXPORTER
    logsExporter: z.string().optional(),            // OTEL_LOGS_EXPORTER
    metricsIntervalMs: z.number().int().positive().optional(),
    logsIntervalMs: z.number().int().positive().optional(),
    tracesFlushIntervalSec: z.number().int().positive().optional(),
  }).optional(),

  // New: Local profiling (global-only)
  perfetto: z.boolean().optional(),
}).optional()
```

#### Sensitive field metadata

Introduce a Zod `.meta({ sensitive: true })` annotation on `secretKey`. The `GET /config` handler strips any field with `sensitive: true` from the response before serialising. The `PATCH /config` handler accepts and writes these fields normally.

This is implemented as a utility `redactSensitiveFields(config: Info): Info` that walks the schema and nulls/removes sensitive fields in a response copy.

---

## 5. API Design

### 5.1 The Rule: `/config` Is the Authority

> **All persistent configuration reads and writes go through `/config`.**

Specialised sub-endpoints (telemetry, MCP add, plugin enable/disable) that currently bypass this — or duplicate it — are either removed or made thin wrappers that delegate to the same config-persistence pipeline.

### 5.2 Endpoint Map (Target)

#### Global tier (server root)

| Method | Path | Change |
|---|---|---|
| `GET` | `/config` | ✅ Keep. Returns global config with sensitive fields redacted. |
| `PATCH` | `/config` | ✅ Keep. Accepts full `Config.Info` partial. Writes through `updateGlobal()`. |
| `GET` | `/telemetry` | ❌ **Remove.** Clients read from `GET /config` and check `telemetry.disabled`. |
| `PATCH` | `/telemetry` | ❌ **Remove.** Clients write `PATCH /config { telemetry: { disabled: false } }`. |

> **Backward compat note**: `GET/PATCH /telemetry` can be kept for one release cycle returning `410 Gone` with a migration message. Deprecation window: Phase 2 ships deprecation warning; Phase 5 removes the handler.

#### Project tier (under `/project/:id`)

| Method | Path | Change |
|---|---|---|
| `GET` | `/project/:id/config` | ✅ Keep. Returns merged project config with sensitive fields stripped. |
| `PATCH` | `/project/:id/config` | ✅ Keep. Writes to project `settings.json`. |
| `GET` | `/project/:id/config/providers` | ✅ Keep. |
| `POST` | `/project/:id/config/mcp` | 🔄 **Fix persistence & Moved**. Now also writes entry to project config. |
| `POST` | `/project/:id/config/mcp/:name/connect` | 🔄 **Fix persistence & Moved**. Now writes `mcp.name.enabled = true` to config. |
| `POST` | `/project/:id/config/mcp/:name/disconnect` | 🔄 **Fix persistence & Moved**. Now writes `mcp.name.enabled = false` to config. |
| `POST` | `/project/:id/config/plugin/:id/enable` | 🔄 **Moved** (already calls updateGlobal — keep, clarify docs). |
| `POST` | `/project/:id/config/plugin/:id/disable` | 🔄 **Moved** (already calls updateGlobal — keep, clarify docs). |

### 5.3 Config Write Contract

Every write goes through the same pipeline regardless of which endpoint triggers it:

```
Client PATCH /config { ... }
       │
       ▼
  Input validated against Config.Info schema (Zod)
       │
       ▼
  Global-only fields stripped if this is a project-scoped write
  (telemetry.*, server.* ignored for project writes)
       │
       ▼
  patchJson(currentFileContent, patch) → preserves JSONC comments, key order
       │
       ▼
  Filesystem.write(settingsPath, updatedContent)
       │
       ▼
  Config cache invalidated (global.reset() or state.reset())
       │
       ▼
  Instance.disposeAll() triggered (so running project sessions pick up changes)
       │
       ▼
  GlobalBus.emit("event", { type: "config.updated" })
       │
       ▼
  Return updated config (sensitive fields redacted)
```

### 5.4 MCP Persistence Design

**Current gap**: `MCP.connect()` / `MCP.disconnect()` / `MCP.add()` are in-memory only.

**Target behaviour:**

```
MCP.add(name, mcpConfig):
  1. Write { mcp: { [name]: mcpConfig } } to project settings.json
  2. Connect in-memory as before
  3. Return status

MCP.connect(name):
  1. Write { mcp: { [name]: { enabled: true } } } to project settings.json
  2. Connect client in-memory
  3. Return status

MCP.disconnect(name):
  1. Write { mcp: { [name]: { enabled: false } } } to project settings.json
  2. Disconnect client in-memory
  3. Return status
```

This is consistent with how plugin enable/disable works. The `enabled` flag in the schema already exists (`McpLocal.enabled`, `McpRemote.enabled`). We're just ensuring writes happen.

> **Design question for agreement**: Should `MCP.disconnect()` write `enabled: false` (persistent off) or write nothing (ephemeral disconnect until restart)? **Recommendation: write `enabled: false`** — explicit, consistent with plugin pattern, avoids surprise reconnects. Operator must explicitly re-enable.

---

## 6. Env Var Policy (Target)

### 6.1 Classification

Env vars are now in exactly two categories:

| Category | Purpose | Examples | In Settings? |
|---|---|---|---|
| **Feature Flags** | Enable/disable code paths, not values | `LITEAI_DISABLE_PROJECT_CONFIG`, `LITEAI_DISABLE_AUTOCOMPACT`, `LITEAI_DISABLE_PRUNE` | No. Flags only. |
| **Path Overrides** | Override filesystem paths for testing/deployment | `LITEAI_HOME`, `LITEAI_CONFIG`, `LITEAI_CONFIG_CONTENT`, `LITEAI_CONFIG_DIR` | No. Deployment overrides. |
| **Security Runtime** | Secrets injected by platform at runtime | `LITEAI_SERVER_CSRF_TOKEN` | No. Injected by infra. |

### 6.2 Env Vars Being Retired (moved to Config)

These are currently read as settings values. After this refactor they move to `Config.Info`:

| Old Env Var | New Config Path | Scope |
|---|---|---|
| `LANGFUSE_PUBLIC_KEY` | `telemetry.langfuse.publicKey` | Global only |
| `LANGFUSE_SECRET_KEY` | `telemetry.langfuse.secretKey` | Global only (write-only via API) |
| `LANGFUSE_BASEURL` / `LANGFUSE_HOST` | `telemetry.langfuse.baseUrl` | Global only |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `telemetry.otel.endpoint` | Global only |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `telemetry.otel.protocol` | Global only |
| `OTEL_TRACES_EXPORTER` | `telemetry.otel.tracesExporter` | Global only |
| `OTEL_METRICS_EXPORTER` | `telemetry.otel.metricsExporter` | Global only |
| `OTEL_LOGS_EXPORTER` | `telemetry.otel.logsExporter` | Global only |
| `OTEL_METRIC_EXPORT_INTERVAL` | `telemetry.otel.metricsIntervalMs` | Global only |
| `OTEL_LOGS_EXPORT_INTERVAL` | `telemetry.otel.logsIntervalMs` | Global only |
| `LITEAI_PERFETTO_TRACE` | `telemetry.perfetto` | Global only |
| `LITEAI_TELEMETRY_DISABLED` | `telemetry.disabled` | Global only |
| `LITEAI_ENABLE_TELEMETRY` (legacy) | `telemetry.disabled` (inverted) | Removed entirely |

### 6.3 Env Var Precedence / Fallback

**Removed immediately**. Env vars like `LANGFUSE_PUBLIC_KEY` and `OTEL_EXPORTER_OTLP_ENDPOINT` will be ignored completely. Operations will strictly rely on `settings.json` via the config API or manual edit. There is no fallback period.

### 6.4 Env Vars That Stay (as flags, not settings)

These remain as env vars because they are deployment-time or platform-injected:

```
LITEAI_HOME                     ← Path override (deployment)
LITEAI_CONFIG                   ← Additional config path (deployment)
LITEAI_CONFIG_DIR               ← Config directory override (deployment)
LITEAI_CONFIG_CONTENT           ← Inline config (CI/testing)
LITEAI_DISABLE_PROJECT_CONFIG   ← Feature flag (testing/enterprise)
LITEAI_DISABLE_AUTOCOMPACT      ← Feature flag
LITEAI_DISABLE_PRUNE            ← Feature flag
LITEAI_PLUGIN_DIR               ← Deployment: pre-loaded plugin directory
LITEAI_PERMISSION               ← Permission override (deployment)
LITEAI_SERVER_CSRF_TOKEN        ← Security (injected by infra)
LITEAI_TEST_MANAGED_CONFIG_DIR  ← Test-only override
```

---

## 7. Instrumentation Bootstrap (New Loading Order)

The current problem: `instrumentation.ts` reads env vars directly because it runs before config is loaded. After this refactor:

```
main.ts startup sequence:
  1. Parse CLI flags (Flag.*)
  2. Load global config → Config.getGlobal()
  3. Apply config → process.env bridge for OTEL SDK compatibility
     (OTEL SDK still expects env vars — we set them from config here, once)
  4. Initialize instrumentation (now sees correct env vars)
  5. Start HTTP server
  6. Load project config (per-request / lazy)
```

### 7.1 Config → Env Bridge (one-time, at startup)

`instrumentation.ts` gains a `applyConfigToEnv(globalConfig: Config.Info)` function:

```typescript
function applyConfigToEnv(config: Config.Info): void {
  const t = config.telemetry
  if (!t) return

  if (t.disabled) process.env.LITEAI_TELEMETRY_DISABLED = "1"
  if (t.langfuse?.publicKey) process.env.LANGFUSE_PUBLIC_KEY = t.langfuse.publicKey
  if (t.langfuse?.secretKey) process.env.LANGFUSE_SECRET_KEY = t.langfuse.secretKey
  if (t.langfuse?.baseUrl) process.env.LANGFUSE_BASEURL = t.langfuse.baseUrl
  if (t.otel?.endpoint) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = t.otel.endpoint
  // ... etc for each mapped field
  // Overrides process.env completely since env fallback is removed immediately
}
```

This bridge is **temporary** — it exists until we refactor the OTEL initializers to read directly from the config instead of `process.env`. By unconditionally overwriting the env vars here, we guarantee that the config source is authoritative and old `process.env` values from `.env` are ignored.

---

## 8. Security Design

### 8.1 Sensitive Field Handling

Fields marked `sensitive: true` in schema metadata:
- `telemetry.langfuse.secretKey`

Rules:
- **Write**: Accepted normally via `PATCH /config`. Written to filesystem in plaintext (same as SSH keys in `~/.ssh/`).
- **Read**: Stripped from `GET /config` response. Replaced with `"*****"` (or omitted). Client knows the field exists but cannot read the value back.
- **Storage**: Plaintext in `settings.json`. This is acceptable because:
  - The file is user-owned (`~/.liteai/settings.json`, mode 600 on Unix)
  - Langfuse credentials are not like passwords — they have limited blast radius
  - This matches how `~/.liteai/auth.json` already stores tokens

> **Future hardening** (out of scope for this refactor): keychain/secret-store integration for sensitive fields. The schema annotation creates the hook point.

### 8.2 Global-Only Enforcement

`telemetry.*` and `server.*` fields MUST NOT be settable at project scope. The `PATCH /project/:id/config` handler silently strips these fields before writing. A warning is emitted in the log.

```typescript
// In project config handler
const GLOBAL_ONLY_KEYS = ["telemetry", "server"] as const
const sanitized = omit(validatedInput, GLOBAL_ONLY_KEYS)
if (Object.keys(validatedInput).some(k => GLOBAL_ONLY_KEYS.includes(k))) {
  log.warn("project config write attempted to set global-only fields — stripped", { stripped: GLOBAL_ONLY_KEYS })
}
```

### 8.3 CSRF / Auth

No change to the existing CSRF token mechanism. All `/config` writes already go through the existing auth middleware.

---

## 9. Backward Compatibility Strategy

| Item | Strategy |
|---|---|
| `settings.json` filename | **Keep**. No rename. Existing files continue to work. |
| Env var fallback | **Kept in Phase 2–4**, removed in Phase 5. |
| `PATCH /telemetry` endpoint | **Deprecated** in Phase 2 (returns 200 + deprecation header), **removed** in Phase 5. |
| `GET /telemetry` endpoint | Same deprecation schedule. |
| `LITEAI_ENABLE_TELEMETRY` | **Removed** immediately in Phase 2 (it was already being replaced by `LITEAI_TELEMETRY_DISABLED`). |
| Existing `telemetry.disabled` field | **Preserved**. Extended, not replaced. |
| MCP `enabled` flag | **Already in schema**. Just needs to be written on connect/disconnect. No schema change needed. |

---

## 10. Design Advice & Analysis

> This section contains architectural opinions and recommendations for the team to agree on before implementation begins.

### ✅ What the Audit Got Right (Keep)

The audit's "minimal, clean" recommendation was correct for the small version. We are expanding it significantly, but the core philosophy holds:
- **One config file, one schema, one API surface** — `GET/PATCH /config` + `Config.Info`
- **No separate `/server-config` endpoint** — this was the right call
- **PATCH /config as the escape hatch** — this becomes the *canonical* path, not a workaround

### ⚠️ Where We Diverge From the Audit

The audit recommended only extending the telemetry schema minimally. We are going further by:

1. **Moving ALL telemetry env vars to config** — This is the right call. The audit's Option C (hybrid per concern) was pragmatic but not a full solution. We go to full config ownership.

2. **Removing `PATCH /telemetry`** — The audit said "optional, keep for backward compat". We recommend removing it on a deprecation schedule. It's a maintenance liability that creates two ways to do the same thing.

3. **MCP persistence is required, not optional** — The audit flagged this. We make it mandatory. Not fixing it means MCP config is still lossy, which undermines the "config as source of truth" goal.

### 🎯 Recommended Design Decisions

**D1: Config → Zod → Filesystem (no custom serialisers)**  
Keep the current `patchJson(fileText, patch)` approach. It preserves JSONC comments and key order. Do NOT switch to `JSON.stringify(mergedObject)` — that would destroy comments in user configs.

**D2: No separate server-config.json**  
Confirmed. `telemetry.*` and `server.*` live in the same `settings.json`. The `global-only` enforcement at the API layer provides the required separation without a new file.

**D3: Config reload on PATCH does NOT require server restart**  
After `PATCH /config`, the server should invalidate the config cache and re-apply settings to in-memory state without restarting. `instrumentation.ts` telemetry config changes are the exception — OTEL SDK initialization is one-shot. A log warning should inform the operator that telemetry changes require restart.

**D4: Write-only fields (secretKey)**  
Use `"*****"` sentinel in GET responses. Do not omit entirely — the UI needs to know the field has a value so it can show "configured" vs "not set" state.

**D5: MCP disconnect = persistent `enabled: false`**  
This matches the plugin pattern and prevents surprise reconnects after restart. Operators who want ephemeral disconnects can use CLI tools that don't go through the API.

**D6: Plugin enable/disable stays as dedicated endpoints**  
They're thin wrappers over `Config.updateGlobal({ enabledPlugins: {...} })` which is exactly right. The UX benefit of named endpoints outweighs the complexity cost. Do NOT remove them.

**D7: Telemetry credential changes require restart (or not?)**  
**Decision needed**: Should `PATCH /config { telemetry: { langfuse: { publicKey: "..." } } }` take immediate effect in the running OTEL pipeline, or require a restart? 

Recommendation: **Require restart for now** (Phase 1). Log a clear `WARN: telemetry config changed, restart required for changes to take effect`. Re-initialising the OTEL SDK at runtime is non-trivial and error-prone. Mark as Phase 6 future work.

### 🔴 Risk Areas

**R1: Instrumentation bootstrap order**  
`instrumentation.ts` initializes telemetry before any request handling. Config loading is async and depends on the filesystem. The startup sequence in `main.ts` must be explicitly ordered. Failure to do this correctly = telemetry initializes with empty config.

**R2: Global config reload on PATCH triggers `Instance.disposeAll()`**  
This is the current behavior. It means `PATCH /config { telemetry: {...} }` terminates all active sessions. This must be clearly documented. Consider whether `telemetry.*` writes should skip `disposeAll()` since they don't affect project state.

**R3: Sensitive fields in logs**  
`Config.updateGlobal()` currently logs the full config object in debug mode. After this change, `secretKey` will be in that object. Add redaction in the logging path.

**R4: `.env` file still in use**  
If the current deployment uses a `.env` file to set `LANGFUSE_*` and `OTEL_*`, users must migrate those values to `settings.json`. Provide a migration guide and a one-time migration script.

---

## 11. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Config write latency | < 50ms for `PATCH /config` (disk write) |
| Schema validation | All writes Zod-validated, errors return HTTP 400 with field-level messages |
| Atomicity | `patchJson` + `Filesystem.write` — currently not atomic. Acceptable for now. Phase 6: atomic write via temp file + rename. |
| Test coverage | Unit tests for `redactSensitiveFields()`, `applyConfigToEnv()`, and MCP persistence. Integration tests for `PATCH /config` with telemetry fields. |
| Documentation | Inline `describe()` on all new schema fields. Docs site page: "Configuration Reference". |

---

## 12. Answered Questions (Decisions)

| # | Decision | Chosen Approach |
|---|---|---|
| D1 | OTEL standard env var fallback | **Removed immediately**. No transitionary fallback to `.env` or system env vars. |
| D2 | Telemetry config trigger `disposeAll()`? | **Skip disposeAll** for telemetry writes since it doesn't affect active sessions. |
| D3 | Sensitive field redaction | **Replace with sentinel `"*****"`** so UI knows it's configured. |
| D4 | MCP disconnect behaviour | **Persistent (`enabled: false`)**, consistent with plugin pattern. |
| D5 | Project settings endpoint URL | **Prefix with `/config`** (`/project/:id/config/mcp/...` and `/project/:id/config/plugin/...`). |

---

## 13. Acceptance Criteria

The refactor is complete when:

- [ ] `settings.json` global config contains `telemetry.langfuse.*` and `telemetry.otel.*` fields with Zod validation
- [ ] `PATCH /config { telemetry: { langfuse: { publicKey: "...", secretKey: "..." } } }` writes and persists credentials  
- [ ] `GET /config` returns `telemetry.langfuse.secretKey: "*****"` when set
- [ ] `instrumentation.ts` strictly overrides OTEL SDK logic based on Config (ignoring outer env vars)
- [ ] `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` legacy env vars are completely ignored
- [ ] `PATCH /telemetry` returns `HTTP 410 Gone` with migration instructions (Phase 2) or is removed (Phase 5)
- [ ] `POST /project/:id/config/mcp` (add) writes to `settings.json`
- [ ] `POST /project/:id/config/mcp/:name/connect` writes `enabled: true` to `settings.json`  
- [ ] `POST /project/:id/config/mcp/:name/disconnect` writes `enabled: false` to `settings.json`
- [ ] MCP enabled state survives server restart
- [ ] Project-scope `PATCH /config` with `telemetry.*` fields logs a warning and strips them
- [ ] All unit tests pass for new config loading, sensitive field redaction, and MCP persistence
- [ ] Web UI settings dialog has a "Server Config" tab showing telemetry toggle and Langfuse config fields

---

## 14. Reference: Existing Code Touchpoints

> For implementers — files that will need changes in each phase.

| File | Role | Phase |
|---|---|---|
| `src/config/schema.ts` | Add `telemetry.langfuse`, `telemetry.otel`, `telemetry.perfetto` | Phase 1 |
| `src/config/loader.ts` | Global-only enforcement, sensitive field redaction utility | Phase 1 |
| `src/config/config.ts` | No changes expected | — |
| `src/telemetry/instrumentation.ts` | `applyConfigToEnv()`, bootstrap ordering | Phase 2 |
| `src/server/routes/global.ts` | Remove/deprecate `GET/PATCH /telemetry`, redact sensitive fields in `GET /config` | Phase 2 |
| `src/server/routes/mcp.ts` | Add config persistence to connect/disconnect/add | Phase 3 |
| `src/mcp/index.ts` | `MCP.connect()`, `MCP.disconnect()`, `MCP.add()` write to config | Phase 3 |
| `src/main.ts` | Explicit startup ordering (config load → `applyConfigToEnv` → instrumentation init) | Phase 2 |
| Web UI settings dialog | Add "Server Config" tab | Phase 4 |
