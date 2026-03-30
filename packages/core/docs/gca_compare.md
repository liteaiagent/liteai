Here is a comprehensive "to the letter" comparison between the Code Assist SDK implementation in `liteai` (`packages/core/src/provider/sdk/code-assist`) and the original `gemini-cli` implementation (`packages/core/src/code_assist/server.ts`), categorizing the exact differences in sending, receiving, and the architectural shifts caused by removing `google-auth-library`.

### 1. Network Transport & Auth (`google-auth-library` Removal Diff)
The most significant changes stem from `liteai` dropping the rigid Google `AuthClient` in favor of a platform-agnostic `fetch` approach.

*   **Client vs Fetch:**
    *   **gemini-cli:** Uses `this.client.request<T>({...})` backed by `google-auth-library` (which relies on `gaxios`). Authentication headers (ADC/OAuth2 tokens) are injected automatically via interceptors.
    *   **liteai:** Uses standard, unopinionated `fetch` passed via `ClientConfig` (`cfg.fetch ?? fetch`). The caller is responsible for injecting the access token via `cfg.headers?.()`.
*   **User-Agent Injection:**
    *   **gemini-cli:** Implicitly relies on the underlying `google-auth-library` and OS defaults to build the User-Agent.
    *   **liteai:** Explicitly computes and injects a deterministic User-Agent: `return cfg.ua ?? 'GeminiCLI/1.0.0/liteai (${os.platform()}; ${os.arch()}; terminal)'`.
*   **Retry Logic mechanism:**
    *   **gemini-cli:** Relies on Gaxios `retryConfig`: `retryDelay: 100`, `statusCodesToRetry: [[429, 429], [499, 499], [500, 599]]`.
    *   **liteai:** Manually implements an async loop (`retryPost`) with `setTimeout`. It handles specific error codes explicitly: `[429, 499, 500, 502, 503, 504]`.
*   **VPC-SC Error Parsing:**
    *   **gemini-cli:** Checks deeply nested properties characteristic of Gaxios/Google API errors: `error.response.data.error.details...`. 
    *   **liteai:** Falls back to inspecting `fetch` error `.message` strings since standard `fetch` exceptions don't serialize nested gRPC error objects the same way.

### 2. State & Architecture (Class vs Pure Functions)
*   **gemini-cli:** Encapsulates the API within a stateful `CodeAssistServer` class implementing `ContentGenerator`. It tracks `projectId`, `sessionId`, `paidTier` credits in-memory, and manages continuous billing/telemetry events during the lifecycle.
*   **liteai:** Shifts to a functional, stateless approach (e.g., `export async function generate(cfg, req)`). State like `ClientConfig` must be passed into every call, making it portable for use inside Vercel AI SDK provider wrappers.

### 3. Sending APIs (Requests & Converter)
*   **Type Dependencies:**
    *   **gemini-cli** imports types directly from `@google/genai` (official SDK).
    *   **liteai** imports generic types from `@ai-sdk/provider` (Vercel AI SDK core) and maps them manually to custom `Vertex*`/`CA*` interfaces to decouple the dependency entirely.
*   **Thought Formatting & Synthetics (Critical Diff):**
    *   **gemini-cli:** Strips `thought` parts into text components (`[Thought: ...]`) as a fallback to ensure older "CountToken" endpoints don't fail, expecting downstream handlers (`GeminiChat`) to fix thought synthetics.
    *   **liteai:** Includes a highly specialized transformation algorithm (`ensureThoughtSignatures`) that traces back to find the "active agent loop" and forcefully injects `SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator"` into the first `functionCall`. Without this, the GCA endpoint throws a `400 Bad Request`.
*   **Tool Choice:** 
    *   **liteai** translates AI SDK `toolChoice` (`auto`, `none`, `required`) into the corresponding GCA `functionCallingConfig` modes (`AUTO`, `NONE`, `ANY`), ensuring compatibility with generic AI SDK behavior. 

### 4. Receiving APIs (Response Parsing & Streaming)
*   **Stream Consumption:**
    *   **gemini-cli:** Relies on Node core streams. Uses `readline.createInterface()` chunking over `Readable.from(res.data)`.
    *   **liteai:** Uses Web Streams (`res.body.getReader()`) and a custom `TextDecoder` buffer loop reading by `indexOf("\n")`. This guarantees browser/edge compatibility without needing Node's `readline`.
*   **Event Boundary Parsing:**
    *   **gemini-cli:** Yields JSON data immediately on encountering an empty line (`if (line === '')`).
    *   **liteai:** Buffers lines prefixed with `data: ` and joins them before issuing `JSON.parse()`, gracefully bypassing `[DONE]` tokens and handling fragmented SSE frames.
*   **Search/Grounding Side-Car:**
    *   **liteai** introduces a dedicated `search(cfg, input)` module method which crafts a synthetic Vertex API request asking for `[{ googleSearch: {} }]`, automatically formats the response text, and appends reference URLs ("Sources: [1] Title (url)"). **gemini-cli** expects the caller to do this.

### 5. Omitted Features (`gemini-cli` logic removed in `liteai`)
Because `liteai`'s goal is leaner platform-agnostic capabilities, it extensively trims components standard to `gemini-cli`:
*   **Mock Variables / Tiers:** As you mentioned, `UserTierId.FREE` usage—in `gemini-cli`, this is heavily leveraged via `createTestServer` mocks in `server.test.ts`, whereas `liteai` declares the broader Tier definitions but acts neutrally without dedicated testing handlers dictating specific feature-flag behavior based on "Free Tier".
*   **Billing/Credits Hooks:** `gemini-cli` actively tracks `getG1CreditBalance`, emits `CreditsUsedEvent`, automatically forces AI model downgrade upon overdraft, and shows UI notifications (`using AI Credits for this request`). *All of this is stripped from `liteai`.*
*   **Telemetry:** `gemini-cli` intercepts first-byte streaming (`streamingLatency.firstMessageLatency`) and logs `recordConversationOffered` / `recordConversationInteraction` via the private metrics API. *Stripped from `liteai`.*
*   **Admin Controls:** Features like `fetchAdminControls`, `AdminControlsSettingsSchema`, limits fetching, and `McpConfigDefinitionSchema` routing are missing in the `liteai` SDK files, assumed handled elsewhere.