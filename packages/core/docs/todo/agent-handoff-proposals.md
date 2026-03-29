# Agent Handoff proposals (Plan -> Build)

## Problem Statement
The transition from the read-only `plan` agent to the executable `build` agent introduces synchronization issues between the client UI and the backend. 

When the `plan_exit` tool completes, it indicates that planning is finished and execution should begin. However, if the client sends a new message before the UI state reflects this transition (e.g., due to race conditions or multiple open tabs), the request payload defaults to `agent: "plan"`. The system needs a bulletproof mechanism to handle this handoff seamlessly so that approved plans can be executed without trapping the user in read-only mode, or breaking their experience altogether.

---

## Proposals

### 1. Backend Handoff Bulletproofing (Message Stream Override)
Intercept incoming requests targeting the `plan` agent in the backend controller (`createUserMessage`). The backend checks the session's stream history. If the most recent transition message was a synthetic approval injected by `plan_exit`, the backend forcefully overrides the client's request to use the `build` agent instead.

* **Complexity:** Low (Confined to `packages/core/src/session/engine/input.ts`)
* **Pros:** Highly effective at preventing the specific race-condition.
* **Risks:** High risk of overriding explicit user intent. If a user *genuinely* selects "plan" from the UI dropdown after an execution phase to draft a new feature, the backend aggressively forces them back into `build` mode because it cannot distinguish a "stale UI payload" from an "intentional user interaction."

### 2. Single "Plan & Execute" Agent Workflow
Instead of swapping agents, keep the session entirely within the `plan` agent. Modify the `plan.md` declarative config to allow edit and command permissions. The `plan_exit` tool flips a session flag that dynamically updates the system prompt to switch the AI from "planning mode" to "execution mode."

* **Complexity:** High (Requires dynamic permission and prompt merging based on state variables)
* **Pros:** Eliminates UI synchronization issues entirely since the agent never changes.
* **Risks:** Breaks the core safety rails of the architecture. The current `plan` mode is strictly read-only enforced by the `action: deny` permission block. Providing executable tools during the planning phase and relying solely on system prompts ("DO NOT EDIT YET") is extremely dangerous, as LLMs frequently ignore prompt constraints when destructive tools are exposed.

### 3. Nested Sub-Agent Orchestrator
Convert the main `plan` agent into a meta-orchestrator. Upon receiving user input, it decides whether to use `TaskTool` to spawn a `sub-plan` agent or a `sub-build` agent.

* **Complexity:** Extreme
* **Pros:** Theoretically flexible and autonomously scalable.
* **Risks:** Sub-agent recursion inside the `TaskTool` introduces enormous context window bloat, extremely difficult state and trace tracing, and would confuse the user's UI experience since rendering deep recursive agent outputs cleanly is highly challenging.

### 4. Client-Side State Synchronization (The UI Handshake)
Modify the `PromptInput` payload to require a `lastSeenMessageID` from the client. When the backend receives an `agent: "plan"` request, it checks if the client's `lastSeenMessageID` is older than the backend's synthetic `plan_exit` transition message. If the client is stale, it safely overrides the agent to `build`. If the client is up to date, it respects the user's explicit drop-down choice to return to `plan`.

* **Complexity:** Medium (API contract change + Frontend updates)
* **Pros:** Technically precise. Completely solves the race condition while preserving user freedom.
* **Risks:** Requires updating the schema pipeline, the core Engine loop, and pushing state variables throughout the Web and CLI contexts.

### 5. Under-the-Hood "Virtual Agent" Swap (Recommended)
Completely hide the transition from the frontend UI. The UI dropdown permanently stays at `plan`. The `plan_exit` tool generates a synthetic approval message but leaves the session agent set to `plan`. Within the backend execution loop (`packages/core/src/session/engine/loop.ts`), we scan the message stream. If `plan_exit` was completed, we initialize a **Virtual Agent** using the `build` profile. We pass the `virtualAgent` into the prompt construction and tool resolvers. The LLM gains execution powers seamlessly.

* **Complexity:** Medium (Requires creating a handoff resolver in the loop logic)
* **Pros:** 
  - Complete seamlessness for the user (looks like a smart, evolving "Single Agent").
  - Eliminates the UI race condition since the frontend never needs to transition.
  - Keeps the hard-boundary safety rails. 
* **Risks:** Slight mismatch in tracking attributes. The database will attribute messages to `agent: "plan"`, even though the actions were carried out using the execution tools of the `build` agent. (This is minimal impact if debugging traces explicitly track the resolved capabilities).

---

## Verdict
**Proposal 5 (Virtual Agent)** is the recommended path forward. It fulfills the user desire for a single "Plan" workflow experience, avoids the safety risks of dismantling declarative read-only permissions, and gracefully avoids client/server state race conditions through backend abstraction.
