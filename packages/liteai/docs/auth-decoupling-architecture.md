# Authentication Decoupling Architecture Plan

## Objective
Decouple the Authentication Provider logic from the generic Workspace `Hooks` system. Specifically, extract `CodexAuthPlugin`, `CopilotAuthPlugin`, `CodeAssistAuthPlugin`, and `Ai4allAuthPlugin` out of the per-instance `INTERNAL_PLUGINS` array and formalize them into a single, global Auth Provider Registry.

## Justification
1. **Prevent Redundant Evaluation:** Currently, auth plugins are evaluated as generic workspace plugins inside `Instance.state`. If a developer has 3 active workspaces, the local server initializes 3 independent `Plugin.state` caches. This causes the internal auth plugins to be fully re-evaluated 3 times across the system.
2. **Proper Separation of Concerns (Global vs Local):** Authentication providers (like Google Code Assist OAuth or generic API tokens) are strictly **global resources** that apply evenly across all workspaces in the application. Evaluating them per-directory is semantically incorrect and implies that a single user session could authenticate differently for different directory or worktree scopes—which the current `AuthService` does not actually support (since tokens are stored globally in standard SQLite rows).
3. **Safe Initialization & Caching:** Because Auth setup occurs inside per-instance scopes, plugin developers currently have to implement messy module-level hacks (e.g., `let cached;` inside Code Assist) to prevent expensive setup calls (like GCP environment resolution) from running multiple times for each workspace instance. A global registry natively isolates expensive initialization logic to execute exactly once during the global daemon boot.

## Detailed Code Changes

### 1. Extract `AuthHook` from Generic Plugin `Hooks`
**File: `src/plugin/types.ts`**
- Delete the `auth?: AuthHook` property from the `Hooks` interface.
- Remove `AuthHook` and `AuthOauthResult` related types and move them to heavily decoupled provider definitions.

### 2. Define the exact `AuthProvider` Interface
**File: `src/auth/provider.ts`** (New File)
```typescript
import type { LiteaiClient } from "@liteai-ai/sdk"

export interface AuthProvider {
  provider: string; // e.g., "google-code-assist"
  
  // Optional expensive setup evaluated exactly ONCE upon global server boot
  setup?(): Promise<void>; 

  // Replaces the convoluted `loader` closure injection. 
  // Invoked locally by SDK interceptors right before HTTP fetch.
  // The contextual params are passed dynamically DURING the request instead of injected at startup.
  interceptFetch?(
    client: LiteaiClient, 
    context: { directory: string; project: string },
    fetchInit: RequestInit
  ): Promise<RequestInit>;

  // Retain existing TUI/browser authorization prompts/methods
  methods: AuthMethod[];
}
```

### 3. Implement the Auth Registry
**File: `src/auth/registry.ts`** (New File)
```typescript
import { CodexAuth } from "./providers/codex"
import { CodeAssistAuth } from "./providers/code-assist"
// ...

export const AUTH_PROVIDERS: AuthProvider[] = [
  CodexAuth,
  CopilotAuth,
  CodeAssistAuth,
  Ai4allAuth
];

// To be called ONLY in Server startup (src/server/server.ts) alongside the DB boot
export async function initializeAuthProviders() {
   await Promise.all(AUTH_PROVIDERS.map(p => p.setup?.()))
}
```

### 4. Refactor `CodeAssist` and other Providers
**Action:** Move files from `src/plugin/*.ts` to `src/auth/providers/*.ts`.
- Instead of exporting a function `CodeAssistAuthPlugin(input)` that returns a nested `Hooks` object, change it to outright export a constant `AuthProvider` static object.
- Any network operations previously guarded with `let cached; x = undefined; if (!cached) ...` should be migrated directly into the `setup()` method provided by the new interface.

### 5. Update `ProviderAuthService` Data Streams
**File: `src/provider/auth-service.ts`**
- Delete the effect filtering mapped to `await Plugin.list()`. 
- Repoint the Effect generator over to `AUTH_PROVIDERS` iterating locally over the registered map. 

### 6. Remove Auth from `INTERNAL_PLUGINS`
**File: `src/plugin/index.ts`**
- Cut imports for `CodexAuthPlugin`, `CopilotAuthPlugin`, `CodeAssistAuthPlugin`, `Ai4allAuthPlugin`.
- Empty or outright delete `INTERNAL_PLUGINS` (and the `log.info("loading internal plugin")` iterating logic if no generic internal plugins remain).
