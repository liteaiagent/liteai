# Data Model: prompt-tray-redesign

## Core Concept
The application transitions from relying on a singular agent identity to capturing orthogonal session parameters. Rather than a session just having a "build" or "plan" agent, the session will now possess an active set of configurations denoting the operational modes of execution.

## Enhanced Types

### 1. Unified `SessionConfig` / `SessionSettings`

**Attributes:**
- `sessionMode` (enum: `"Normal" | "Coordinator" | "Swarm"`): Defines the architectural flow of the active engine. Default: `"Normal"`.
- `toolProfile` (enum: `"Plan" | "Fast"`): Determines whether the root model has permission to enter planning phases. Default: `"Plan"`.
- `forkEnabled` (boolean): Flag instructing whether recursive or subagent systems spawn with optimized, isolated context cache. Default: `false`.
- `agentIdentity` (string): The selected root assistant persona. Replaces the implicit agent ID. Defaults to `"build"` (display name: "LiteAI").

## Storage Engine Extensions
We expect to append the aforementioned UI options into a JSON structure or discrete columns in the existing `SessionTable` entity tracked by Drizzle.

### `SessionTable`
**Added fields**:
- `session_mode`: string/enum
- `tool_profile`: string/enum 
- `fork_enabled`: boolean (integer mapped)

_(If a single `config` JSON text field is preferred over schema expansion, these properties will reside under the `session.config` mapping)_.
