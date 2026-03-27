# Code Assist API Parity with Gemini CLI

## Overview

Exhaustive audit of how `liteai` communicates with the Code Assist server (`cloudcode-pa.googleapis.com/v1internal`) compared to `gemini-cli`. The goal is to match gemini-cli's behavior **exactly** — including retry logic, headers, request/response fields, and edge-case handling.

Source of truth: `gemini-cli/packages/core/src/code_assist/` (server.ts, converter.ts, setup.ts, oauth2.ts, telemetry.ts, types.ts).

## Status

| # | Area | Severity | Status |
|---|---|---|---|
| 1 | User-Agent header | Medium | ✅ Done |
| 2 | `enabled_credit_types` in request | High | ✅ Done |
| 3 | `consumedCredits`/`remainingCredits` in response | Medium | ✅ Done |
| 4 | POST retry logic (429/499/5xx) | High | ✅ Done |
| 5 | `generateContent` retry delay (1000ms) | Medium | ✅ Done |
| 6 | VPC-SC graceful fallback | Medium | ✅ Done |
| 7 | Default thinking budget cap (8192) | Medium | ✅ Done |
| 8 | Telemetry endpoints | Low | ⬜ Not done |
| 9 | Rich `ClientMetadata` for metrics | Low | ⬜ Not done |

---

## ✅ Done

### 1. User-Agent Header

**Gemini CLI format:**
```
GeminiCLI/${version}/${model} (${platform}; ${arch}; ${surface})
```
- `version` — dynamic from `package.json`
- `model` — the resolved model name (e.g. `gemini-3-pro-preview`)
- `surface` — auto-detected IDE/environment (`terminal`, `vscode`, `cursor`)

**What changed:** `ClientConfig` now has a `ua` field. The default includes `terminal` as surface. The caller can override it with the model name and version to match gemini-cli exactly. The old hardcoded string is gone.

**Files:** `client.ts`

---

### 2. `enabled_credit_types` in Request Body

**Gemini CLI:** Sends `enabled_credit_types: ["GOOGLE_ONE_AI"]` in the `CAGenerateContentRequest` envelope when the user has overage billing enabled and the model is eligible.

**What changed:**
- Added `enabled_credit_types?: string[]` to `CAGenerateContentRequest` (types.ts)
- Added `enabledCreditTypes` to `ConvertOptions` (converter.ts)
- Passes it through in `toRequest()` (converter.ts)
- Added `Credits` type, `CreditType` type, `G1_CREDIT_TYPE` constant (types.ts)
- Exported `Credits` and `G1_CREDIT_TYPE` from index.ts

**Files:** `types.ts`, `converter.ts`, `index.ts`

**Caller responsibility:** The provider or auth layer must pass `enabledCreditTypes: ["GOOGLE_ONE_AI"]` via the converter options or through the language model when credits are available.

---

### 3. `consumedCredits` / `remainingCredits` in Response

**Gemini CLI:** Parses these from every streaming chunk and unary response. Used to:
1. Sum consumed credits and emit `CreditsUsedEvent` billing telemetry
2. Live-update `paidTier.availableCredits` in memory
3. Log billing events after stream completes

**What changed:** Added `consumedCredits?: Credits[]` and `remainingCredits?: Credits[]` to `CAGenerateContentResponse` (types.ts). The fields are now parseable from the JSON response.

**Files:** `types.ts`

**Remaining:** Actual consumption tracking (summing credits, updating paid tier state) is not implemented — this is part of the telemetry/billing system (item #8).

---

### 4. POST Retry Logic

**Gemini CLI** (server.ts `requestPost`):
```ts
retryConfig: {
  retryDelay: 100,    // default; 1000ms for generateContent
  retry: 3,
  noResponseRetries: 3,
  statusCodesToRetry: [[429, 429], [499, 499], [500, 599]],
}
```

**What changed:** Added `retryPost()` helper in `client.ts` that:
- Retries up to 3 times (matching `retry: 3`)
- Retries on status codes: 429, 499, 500, 502, 503, 504 (matching `[500, 599]` range)
- Uses configurable delay between retries
- All POST methods (`generate`, `loadCodeAssist`, `onboardUser`) now use this helper

**Files:** `client.ts`

---

### 5. `generateContent` Retry Delay (1000ms)

**Gemini CLI:**
```ts
const GENERATE_CONTENT_RETRY_DELAY_IN_MILLISECONDS = 1000;
// Used only for generateContent, not other POST methods
```

**What changed:** `generate()` now passes `RETRY_GENERATE_DELAY = 1000` to `retryPost()`. Other methods use `RETRY_DEFAULT_DELAY = 100`.

**Files:** `client.ts`

---

### 6. VPC-SC Graceful Fallback

**Gemini CLI** (server.ts lines 263–280): If `loadCodeAssist` throws and the error contains `SECURITY_POLICY_VIOLATED` in its details, it returns `{ currentTier: { id: UserTierId.STANDARD } }` instead of throwing — gracefully degrading for enterprise users behind VPC Service Controls.

**What changed:** `loadCodeAssist()` now wraps the call in try/catch and checks for `SECURITY_POLICY_VIOLATED` in the error message. Falls back to `{ currentTier: { id: UserTierId.STANDARD } }`.

**Files:** `client.ts`

---

### 7. Default Thinking Budget Cap (8192)

**Gemini CLI** (models.ts):
```ts
export const DEFAULT_THINKING_MODE = 8192;
```
Caps thinking at 8192 tokens to prevent run-away thinking loops.

**What changed:** `toGenerationConfig()` now always sets `thinkingBudget: budget ?? 8192` instead of only setting it when explicitly provided. This prevents unbounded thinking.

**Files:** `converter.ts`

---

## ⬜ Not Done

### 8. Telemetry Endpoints

**Gemini CLI** calls these endpoints for reporting:

| Endpoint | Method | Purpose |
|---|---|---|
| `recordCodeAssistMetrics` | POST | Generic metrics container |
| `recordConversationOffered` | via above | Reports each generation: traceId, latency, citation count, `isAgentic: true` |
| `recordConversationInteraction` | via above | Reports tool acceptance/rejection with diff line stats |
| `listExperiments` | POST | Fetches A/B experiment flags |
| `retrieveUserQuota` | POST | Checks user quota buckets |
| `fetchAdminControls` | POST | Checks admin controls, strict mode, MCP config |
| `getCodeAssistGlobalUserSetting` | GET | Gets user data collection opt-in |
| `setCodeAssistGlobalUserSetting` | POST | Sets user data collection opt-in |

Key data structures for telemetry:
```ts
interface ConversationOffered {
  citationCount?: string
  includedCode?: boolean
  status?: ActionStatus           // NO_ERROR | ERROR_UNKNOWN | CANCELLED | EMPTY
  traceId?: string
  streamingLatency?: {
    firstMessageLatency?: string  // e.g. "1.234s"
    totalLatency?: string
  }
  isAgentic?: boolean             // always true for CLI
  initiationMethod?: number       // COMMAND = 2
  trajectoryId?: string           // = sessionId
}

interface ConversationInteraction {
  traceId: string
  status?: ActionStatus
  interaction?: number            // ACCEPT_FILE = 7
  acceptedLines?: string
  removedLines?: string
  language?: string
  isAgentic?: boolean
  initiationMethod?: number
}
```

**Impact:** Missing telemetry means Google cannot track usage patterns, latency, or agentic engagement. This **may** affect quota allocation or model routing decisions in the future. Currently does not affect functionality.

**Priority:** Low — non-functional. Consider adding if we observe quota differences vs gemini-cli.

---

### 9. Rich `ClientMetadata` for Metrics

**Gemini CLI** sends richer metadata for `recordCodeAssistMetrics`:
```ts
{
  ideName: "IDE_UNSPECIFIED",
  pluginType: "GEMINI",
  ideVersion: "1.5.0",           // dynamic from package.json
  platform: "WINDOWS_AMD64",     // platform-specific enum value
  updateChannel: "stable",       // from release channel detection
}
```

LiteAI currently uses the simpler metadata (matching for `loadCodeAssist`/`onboardUser`):
```ts
{
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
}
```

**Impact:** Only relevant if telemetry (item #8) is implemented.

**Priority:** Low — blocked by item #8.

---

## Already Matching (No Changes Needed)

These areas were audited and found to already match gemini-cli:

| Area | Details |
|---|---|
| **Endpoint & version** | Both use `cloudcode-pa.googleapis.com/v1internal` |
| **SSE stream parsing** | Both correctly parse `data: ` lines with multi-line buffering |
| **Streaming: no retry** | Both disable retry for streaming requests |
| **Session ID** | Passed via `providerOptions['code-assist'].sessionId` → `request.session_id` |
| **`user_prompt_id`** | Both generate unique IDs (gemini-cli from scheduler, liteai from `generateId()`) |
| **Thought signature constant** | Both use `skip_thought_signature_validator` |
| **`loadCodeAssist` request shape** | Identical fields: `cloudaicompanionProject`, `metadata`, `mode` |
| **`onboardUser` request shape** | Identical: `tierId`, `cloudaicompanionProject`, `metadata` |
| **LRO polling delay** | Both poll at 5-second intervals |
| **`ClientMetadata` for onboarding** | Both send `{ideType, platform, pluginType}` as `UNSPECIFIED`/`GEMINI` |
| **OAuth scopes** | Verify match: `cloud-platform`, `userinfo.email`, `userinfo.profile` |
| **Bearer token format** | Both send `Authorization: Bearer <token>` |

---

## Relevant Files

### LiteAI (changed)
- `packages/liteai/src/provider/sdk/code-assist/client.ts` — HTTP client with retry, VPC-SC
- `packages/liteai/src/provider/sdk/code-assist/types.ts` — API types with credits
- `packages/liteai/src/provider/sdk/code-assist/converter.ts` — Request converter with credit types + budget cap
- `packages/liteai/src/provider/sdk/code-assist/index.ts` — Exports

### Gemini CLI (reference)
- `packages/core/src/code_assist/server.ts` — CodeAssistServer class (HTTP methods, retry, VPC-SC, streaming)
- `packages/core/src/code_assist/converter.ts` — Request/response conversion
- `packages/core/src/code_assist/setup.ts` — User onboarding, project discovery
- `packages/core/src/code_assist/telemetry.ts` — Telemetry recording
- `packages/core/src/code_assist/types.ts` — All API types
- `packages/core/src/code_assist/oauth2.ts` — OAuth client ID/secret/scopes
- `packages/core/src/core/contentGenerator.ts` — User-Agent construction
- `packages/core/src/core/geminiChat.ts` — Thought signature enforcement
- `packages/core/src/config/models.ts` — `supportsModernFeatures()`, `DEFAULT_THINKING_MODE`
- `packages/core/src/utils/session.ts` — Session ID generation
- `packages/core/src/code_assist/experiments/client_metadata.ts` — Rich client metadata
