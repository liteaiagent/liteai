# Code Assist Communication: Gemini CLI vs LiteAI — Exhaustive Diff

> [!IMPORTANT]
> This document catalogs **every** difference between how `gemini-cli` and `liteai` communicate with the Code Assist server at `cloudcode-pa.googleapis.com/v1internal`.

---

## 1. User-Agent Header

### Gemini CLI ([contentGenerator.ts:188-192](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/core/contentGenerator.ts#L188-L192))
```
GeminiCLI/${version}/${model} (${platform}; ${arch}; ${surface})
```
- `version` — dynamic from [package.json](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/package.json) (e.g. `1.5.0`)
- `model` — the **resolved model name** (e.g. `gemini-3-pro-preview`)
- `platform` — `process.platform` (e.g. `win32`)
- [arch](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/client.ts#220-256) — `process.arch` (e.g. `x64`)
- `surface` — auto-detected IDE/environment (e.g. `terminal`, `vscode`, `cursor`)

Also supports `clientName` prefix: `GeminiCLI-${clientName}/${version}/${model} (…)`

### LiteAI ([client.ts:18](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/client.ts#L18))
```
GeminiCLI/1.0.0/liteai (${os.platform()}; ${os.arch()})
```
- **Hardcoded** `1.0.0` version
- **Static** `liteai` instead of model name
- **Missing** surface identifier

> [!WARNING]
> The `User-Agent` includes the model name in gemini-cli. This may affect routing/capabilities on the server side.

---

## 2. Request Body: `enabled_credit_types` Field

### Gemini CLI ([converter.ts:33-39](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/converter.ts#L33-L39), [server.ts:109-122](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L109-L122))
```ts
interface CAGenerateContentRequest {
  model: string;
  project?: string;
  user_prompt_id?: string;
  request: VertexGenerateContentRequest;
  enabled_credit_types?: string[];  // ← THIS FIELD
}
```

When billing auto-use is enabled and the model is overage-eligible:
```ts
enabled_credit_types: ["GOOGLE_ONE_AI"]
```

### LiteAI ([types.ts:89-94](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/types.ts#L89-L94))
```ts
interface CAGenerateContentRequest {
  model: string
  project?: string
  user_prompt_id?: string
  request: VertexGenerateContentRequest
  // ❌ MISSING: enabled_credit_types
}
```

> [!CAUTION]
> Missing `enabled_credit_types` may prevent users from using AI Credits.

---

## 3. Response Fields: `consumedCredits` / `remainingCredits`

### Gemini CLI ([converter.ts:77-82](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/converter.ts#L77-L82), [server.ts:159-175](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L159-L175))
```ts
interface CaGenerateContentResponse {
  response?: VertexGenerateContentResponse;
  traceId?: string;
  consumedCredits?: Credits[];   // ← PARSED & TRACKED
  remainingCredits?: Credits[];  // ← PARSED & TRACKED
}
```

Used to:
1. Sum consumed credits and emit `CreditsUsedEvent`
2. Update `paidTier.availableCredits` in memory
3. Log billing telemetry

### LiteAI ([types.ts:148-151](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/types.ts#L148-L151))
```ts
interface CAGenerateContentResponse {
  response?: VertexGenerateContentResponse
  traceId?: string
  // ❌ MISSING: consumedCredits, remainingCredits
}
```

---

## 4. Retry Logic on POST Requests

### Gemini CLI ([server.ts:401-428](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L401-L428))
```ts
async requestPost<T>(method, req, signal?, retryDelay = 100) {
  res = await this.client.request<T>({
    // ...
    retryConfig: {
      retryDelay,
      retry: 3,
      noResponseRetries: 3,
      statusCodesToRetry: [
        [429, 429],
        [499, 499],
        [500, 599],
      ],
    },
  });
}
```

For [generateContent](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#194-236) specifically, the retry delay is **1000ms** (not the default 100ms):
```ts
// server.ts:75
const GENERATE_CONTENT_RETRY_DELAY_IN_MILLISECONDS = 1000;

// server.ts:211
requestPost('generateContent', req, signal,
  GENERATE_CONTENT_RETRY_DELAY_IN_MILLISECONDS);
```

### LiteAI
**❌ No retry logic at all.** A single failed request will immediately error.

> [!WARNING]
> This is critical. 429 rate limits and transient 500 errors are common and retries are essential.

---

## 5. Streaming: `retry: false`

### Gemini CLI ([server.ts:456-475](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L456-L475))
```ts
async requestStreamingPost(method, req, signal?) {
  res = await this.client.request({
    // ...
    params: { alt: 'sse' },
    responseType: 'stream',
    retry: false,  // ← Explicitly disabled
  });
}
```

### LiteAI ([client.ts:64-79](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/client.ts#L64-L79))
Uses raw [fetch()](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#301-309) — no retry mechanism, which is effectively the same as `retry: false`.

✅ **Match** (both don't retry streaming requests)

---

## 6. Session ID

### Gemini CLI ([session.ts](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/utils/session.ts))
```ts
export const sessionId = randomUUID();
```
- Created once per process as a `randomUUID()`
- Passed to [CodeAssistServer](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#77-526) constructor
- Sent in request body as `request.session_id`
- Also used as `trajectoryId` for telemetry

### LiteAI
Session ID is passed via `providerOptions['code-assist'].sessionId` and ends up in `request.session_id`. The mechanism is present but the **creation** depends on the caller.

✅ **Functionally similar** — but validate the caller always provides a UUID.

---

## 7. `user_prompt_id` Generation

### Gemini CLI ([server.ts:91-92](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L91-L92))
The `userPromptId` is passed as a parameter from the caller (scheduler/agent). It comes from `promptIdContext` which tracks per-user-message prompt IDs.

### LiteAI ([converter.ts:37](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/converter.ts#L37))
```ts
user_prompt_id: generateId()
```
Auto-generated with `generateId()` from `@ai-sdk/provider-utils`.

✅ **Acceptable** — both produce unique IDs, just from different sources.

---

## 8. Thought Signature Enforcement

### Gemini CLI ([geminiChat.ts:777-822](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/core/geminiChat.ts#L777-L822))
Only applied for models where [supportsModernFeatures(model)](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/config/models.ts#360-371) returns true (Gemini 3+, custom models). For older models (2.5 Pro/Flash), thought signatures are **stripped** entirely.

```ts
const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';
```

### LiteAI ([converter.ts:196-224](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/converter.ts#L196-L224))
Always applied regardless of model. Uses same constant:
```ts
const SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator"
```

> [!NOTE]
> LiteAI always injects thought signatures. This should be fine since it always enables thinking too. If the server strips them for non-thinking models, it's harmless.

---

## 9. Telemetry / Metrics Recording

### Gemini CLI — Full Telemetry Suite

| Endpoint | Method | Purpose |
|---|---|---|
| [recordCodeAssistMetrics](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#395-400) | POST | Generic metrics |
| [recordConversationOffered](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/telemetry.ts#33-60) | In code | Report each generation with trace ID, latency, citation count |
| [recordConversationInteraction](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#376-394) | In code | Report tool acceptance/rejection with diff stats |
| [listExperiments](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#339-352) | POST | Fetch A/B experiments |
| [retrieveUserQuota](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#353-361) | POST | Check user quota |
| [fetchAdminControls](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#301-309) | POST | Check admin controls/strict mode |
| [getCodeAssistGlobalUserSetting](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#310-315) | GET | Get user data collection settings |
| [setCodeAssistGlobalUserSetting](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#316-324) | POST | Set user data collection settings |

Key telemetry data sent per request:
```ts
interface ConversationOffered {
  citationCount?: string;
  includedCode?: boolean;
  status?: ActionStatus;
  traceId?: string;
  streamingLatency?: StreamingLatency;
  isAgentic?: boolean;
  initiationMethod?: InitiationMethod;  // COMMAND
  trajectoryId?: string;                // = sessionId
}
```

### LiteAI
**❌ None of these telemetry endpoints are called.**

> [!IMPORTANT]
> Missing telemetry means the server doesn't know about tool acceptance, latency metrics, or agentic usage patterns. This **may** affect quota allocation or routing decisions.

---

## 10. [ClientMetadata](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/types.ts#4-14) in Requests

### Gemini CLI ([client_metadata.ts](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/experiments/client_metadata.ts))
For [loadCodeAssist](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#263-281) and metrics:
```ts
const META = {
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
}
```

For [recordCodeAssistMetrics](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#395-400), full metadata:
```ts
{
  ideName: 'IDE_UNSPECIFIED',
  pluginType: 'GEMINI',
  ideVersion: await getVersion(),       // ← dynamic version
  platform: getPlatform(),              // ← e.g. 'WINDOWS_AMD64'
  updateChannel: await getReleaseChannel(), // ← e.g. 'stable'
}
```

### LiteAI ([setup.ts:50-54](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/setup.ts#L50-L54))
```ts
const META = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
}
```

> [!NOTE]
> LiteAI matches for [loadCodeAssist](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#263-281)/[onboardUser](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#253-258). Missing the rich metadata for metrics (not called anyway).

---

## 11. OAuth Client ID & Secret

### Gemini CLI ([oauth2.ts:72-81](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/oauth2.ts#L72-L81))
```ts
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
```

### LiteAI
✅ **Verify these match** in the auth plugin. If liteai uses the same client ID/secret, the bearer tokens will be identical.

---

## 12. Bearer Token Injection

### Gemini CLI
Uses `google-auth-library`'s `AuthClient.request()` which **automatically** injects `Authorization: Bearer <token>` and handles refresh.

### LiteAI
Uses a custom [fetch](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#301-309) function wrapper that injects the bearer token via [headers()](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/provider.ts#40-44) callback:
```ts
headers: () => ({
  ...settings.headers,
  ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
})
```

> [!NOTE]
> Both produce `Authorization: Bearer <token>`. The difference is the injection mechanism. LiteAI's approach is fine as long as the token is refreshed before expiry.

---

## 13. [loadCodeAssist](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#263-281) Retry & VPC-SC Handling

### Gemini CLI ([server.ts:263-280](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L263-L280))
```ts
async loadCodeAssist(req) {
  try {
    return await this.requestPost('loadCodeAssist', req);
  } catch (e) {
    if (isVpcScAffectedUser(e)) {
      return { currentTier: { id: UserTierId.STANDARD } };
    }
    throw e;
  }
}
```

VPC-SC detection checks for `SECURITY_POLICY_VIOLATED` in error details.

### LiteAI ([client.ts:135-151](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/client.ts#L135-L151))
```ts
async function loadCodeAssist(cfg, req) {
  // No VPC-SC handling, no retry
  const res = await fn(url(cfg, "loadCodeAssist"), { ... })
  if (!res.ok) throw ...
  return res.json()
}
```

**❌ Missing VPC-SC fallback.** Enterprise users behind VPC Service Controls will get an error instead of graceful degradation.

---

## 14. LRO Polling Delay

### Gemini CLI ([setup.ts:243](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/setup.ts#L243))
```ts
await new Promise((f) => setTimeout(f, 5000));  // 5 second delay
```

### LiteAI ([setup.ts:115](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/setup.ts#L115))
```ts
await new Promise((r) => setTimeout(r, 5000))  // 5 second delay
```

✅ **Match**

---

## 15. Thinking Config

### Gemini CLI
Always enables thinking via generation config for Code Assist. The thinking budget cap is `DEFAULT_THINKING_MODE = 8192`.

### LiteAI ([converter.ts:236-243](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/converter.ts#L236-L243))
```ts
cfg.thinkingConfig = { includeThoughts: true }
const budget = opts.providerOptions?.["code-assist"]?.thinkingBudget
if (budget !== undefined) cfg.thinkingConfig.thinkingBudget = budget
```

> [!TIP]
> LiteAI enables thinking but doesn't set a default budget cap. Gemini-cli caps at 8192 to prevent runaway thinking. Consider adding a default cap.

---

## 16. Stream SSE Parsing

### Gemini CLI ([server.ts:477-507](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#L477-L507))
Uses Node's `readline.createInterface` over a `Readable.from(res.data)`:
```ts
const rl = readline.createInterface({
  input: Readable.from(res.data),
  crlfDelay: Infinity,
});
// Parses "data: " lines, joins multi-line chunks
```

### LiteAI ([client.ts:91-132](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/client.ts#L91-L132))
Uses `ReadableStream.getReader()` with manual line parsing:
```ts
const reader = res.body.getReader()
const decoder = new TextDecoder()
// Manual \n splitting with buffer
```

> [!NOTE]
> Both implementations parse SSE correctly. LiteAI also flushes remaining buffered data at end of stream, which gemini-cli does not (relies on readline's close event).

---

## Summary: Changes Applied

| # | Area | Severity | Status |
|---|---|---|---|
| 1 | User-Agent | 🟡 Medium | ✅ Fixed — configurable [ua](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/client.ts#34-37) field with surface |
| 2 | `enabled_credit_types` | 🔴 High | ✅ Fixed — added to types + converter |
| 3 | `consumedCredits`/`remainingCredits` | 🟡 Medium | ✅ Fixed — types added to response |
| 4 | POST retry logic | 🔴 High | ✅ Fixed — 3 retries for 429/499/5xx |
| 5 | [generateContent](file:///C:/Users/aghassan/Documents/workspace/gemini-cli/packages/core/src/code_assist/server.ts#194-236) retry delay | 🟡 Medium | ✅ Fixed — 1000ms for generateContent |
| 6 | VPC-SC fallback | 🟡 Medium | ✅ Fixed — SECURITY_POLICY_VIOLATED catch |
| 7 | Telemetry endpoints | 🟢 Low | Not implemented (not required for core) |
| 8 | Default thinking budget | 🟡 Medium | ✅ Fixed — 8192 default cap |
| 9 | Rich [ClientMetadata](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/liteai/src/provider/sdk/code-assist/types.ts#4-14) | 🟢 Low | Not implemented (only needed with telemetry) |

