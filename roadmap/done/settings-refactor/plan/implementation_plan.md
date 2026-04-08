# Settings Refactor Implementation Plan

> **Goal**: Make `settings.json` and the `/config` endpoints the definitive source of truth for all non-volatile settings (telemetry, MCP connections, plugin state). Demote env vars to feature flags only.

CRITICAL INSTRUCTION: Use your tools, only use shell if you do not have a tool that can do the same job (e.g. running lint or typecheck). DO NOT use scripts to automate file edits

## Phase 1: Extend Schema & Harden Config Security [COMPLETED]
**Objective**: Build the foundational config fields and ensure secure API reading/writing.

1. **Update `src/config/schema.ts`**:
   - Add `telemetry.langfuse` block (`publicKey`, `secretKey`, `baseUrl`).
   - Add `telemetry.otel` block (`endpoint`, `protocol`, `*Exporter`, `*IntervalMs`).
   - Add `telemetry.perfetto` flag.
   - Decorate `secretKey` with `.meta({ sensitive: true })`.
2. **Update `src/config/loader.ts`**:
   - Add a `redactSensitiveFields()` utility that nulls or sets `"*****"` for fields annotated with `sensitive: true`.
   - Update `get()` and `getGlobal()` API handlers to utilize this utility before returning responses.
   - Enforce global-only fields (`telemetry.*`, `server.*`) — drop them from the payload with a warning when processed in standard project config updates (`PATCH /project/:id/config`).
   - Modify the `updateGlobal()` lifecycle: skip triggering `disposeAll()` if the *only* properties modified were within the `telemetry` block.

**Success Criteria:**
- [x] **Lint**: `bun lint:fix` passes. Unused variables in modified files must be analyzed; either used, explicitly removed, or prefixed with `_` with justification. Errors should be logged instead of swallowed.
- [x] **Typecheck**: `bun typecheck` passes without errors.
- [x] **Tests**: `bun test test/config/` passes. Add new focused tests for sensitive field redaction logic and global-only field stripping.

## Phase 2: Immediate Env Var Purge & Instrumentation Bootstrapping
**Objective**: Hardcode telemetry's reliance on config rather than `.env` variables.

1. **Fix Startup Order (`src/main.ts`)**:
   - Ensure the server explicitly boots the `loader.ts` global config *before* attempting to invoke the `instrumentation.ts` OpenTelemetry setup.
2. **Implement Config-to-Env Priority Bridge (`src/telemetry/instrumentation.ts`)**:
   - Add `applyConfigToEnv()` right after config resolution.
   - Overwrite applicable `process.env` keys explicitly with the values obtained from the global config.
   - Ignore existing external system/process environments for `LANGFUSE_*`/`OTEL_*` keys — the config file is now the absolute truth and cannot fallback to `.env`.
3. **Clean Legacy Code**:
   - Delete usages or fallbacks of legacy env variables (like `LITEAI_ENABLE_TELEMETRY`).

**Success Criteria:**
- [x] **Lint**: `bun lint:fix` passes. Unused variables in modified files must be analyzed; either used, explicitly removed, or prefixed with `_` with justification. Errors should be logged instead of swallowed.
- [x] **Typecheck**: `bun typecheck` passes without errors.
- [x] **Tests**: `bun test test/telemetry/` passes. Add focused tests validating the configuration bridge (`applyConfigToEnv()`) correctly overwrites without any trace of prior environment config.

## Phase 3: Route Refactoring & Persistence Overhaul
**Objective**: Adopt the `/config/...` namespace inside projects and ensure transient settings turn persistent.

1. **Fix MCP Settings Persistence (`src/mcp/index.ts` & `routes/mcp.ts`)**:
   - Wire `MCP.add()` to write the server definition into `Config.Info`.
   - Wire `MCP.connect()` to write `{ enabled: true }`.
   - Wire `MCP.disconnect()` to write `{ enabled: false }` indefinitely.
2. **Route Prefix Renames**:
   - Move MCP write endpoints: `POST /project/:id/mcp/...` becomes `POST /project/:id/config/mcp/...`.
   - Move Plugin write endpoints: `POST /project/:id/plugin/:id/...` becomes `POST /project/:id/config/plugin/:id/...`.
   - Ensure SDK or external clients are updated to direct calls to the new `/config/XYZ` URL prefixes.

**Success Criteria:**
- [x] **Lint**: `bun lint:fix` passes. Unused variables in modified files must be analyzed; either used, explicitly removed, or prefixed with `_` with justification. Errors should be logged instead of swallowed.
- [x] **Typecheck**: `bun typecheck` passes without errors.
- [x] **Tests**: `bun test test/mcp/ test/server/` passes. Ensure new tests directly invoke MCP operations to assert config persistence behaves properly. Update existing assertions for the newly-prefixed `/config/` REST URLs.

## Phase 4: Deprecation and UI Integration
**Objective**: Retain backward compatibility where required while lighting up the new feature set in the admin interface.

1. **Deprecate Global Telemetry Endpoints (`src/server/routes/global.ts`)**:
   - Modify `GET /telemetry` and `PATCH /telemetry` to wrap the `config` mechanism as a fallback for old clients, while returning standard deprecation messages/headers indicating migration to `/config`.
2. **UI Updates (`packages/web` or Core Settings)**:
   - Introduce a "Server Config" tab in the generic settings dialog.
   - Render fields querying directly against `telemetry.langfuse.*` rather than legacy dedicated components.

**Success Criteria:**
- [x] **Lint**: `bun lint:fix` passes. Unused variables in modified files must be analyzed; either used, explicitly removed, or prefixed with `_` with justification. Errors should be logged instead of swallowed.
- [x] **Typecheck**: `bun typecheck` passes without errors.
- [x] **Tests**: `bun test test/server/` passes tracking deprecated routers correctly. (Optional: Check UI test packages if relevant settings tests exist).
