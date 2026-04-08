# MCP OAuth Remote Decoupling — Implementation Plan

## Problem Statement

`packages/core` currently assumes it runs locally on the user's machine with a graphical desktop. The OAuth flow spawns a browser via the `open` package and spins up a local HTTP server on `127.0.0.1:19876` to intercept the IdP callback. This architecture prevents running core as a headless remote backend (SSH, containers, cloud VMs, multi-tenant SaaS).

## Design Decision

Adopt the **Auth Strategy Pattern**: core defines an `McpAuthStrategy` interface and ships a `HeadlessAuthStrategy` as the default. Client packages (`cli`, `web`, `vscode`) inject their own strategy implementations. This provides clean Inversion of Control without losing the imperative `startAuth → finishAuth` API surface.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  packages/core (headless backend)                       │
│                                                         │
│  MCP.startAuth() / MCP.finishAuth()                     │
│       │                                                 │
│       ▼                                                 │
│  McpOAuthProvider                                       │
│       │                                                 │
│       ▼                                                 │
│  McpAuthStrategy (interface)  ◄─ HeadlessAuthStrategy   │
│                                   (default: no browser) │
│       │                                                 │
│       ▼                                                 │
│  McpAuth (credential storage)                           │
└─────────────┬───────────────────────────────────────────┘
              │ strategy injection
              ▼
┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│ packages/cli        │  │ packages/web     │  │ packages/vscode     │
│                     │  │                  │  │                     │
│ BrowserAuthStrategy │  │ WebAuthStrategy  │  │ VscodeAuthStrategy  │
│ - open()            │  │ - popup/redirect │  │ - openExternal()    │
│ - localhost:19876   │  │ - window.postMsg │  │ - URI handler       │
│   callback server   │  │                  │  │                     │
└─────────────────────┘  └──────────────────┘  └─────────────────────┘
```

---

## Phase 1 — Core Headless Foundation

> **Goal:** Make `packages/core` fully headless. No browser, no local callback server.  
> **Breaking:** Yes — `liteai mcp auth` via CLI will stop working until Phase 2.  
> **Estimated files changed:** 7

### 1.1 Define `McpAuthStrategy` Interface

**[NEW] `packages/core/src/mcp/auth-strategy.ts`**

```typescript
export interface McpAuthStrategy {
  /**
   * The OAuth redirect URI for this client environment.
   * E.g., `http://127.0.0.1:19876/mcp/oauth/callback` for CLI,
   *       `https://app.liteai.com/mcp/oauth/callback` for Web,
   *       `vscode://liteai.liteai/mcp/oauth` for VSCode.
   */
  readonly redirectUri: string

  /**
   * Handle the IdP's authorization URL.
   * CLI: open browser. Web: redirect/popup. Headless: no-op.
   */
  handleAuthorization(url: URL): Promise<void>

  /**
   * Wait for the user to complete authorization and return the code.
   * CLI: local callback server. Web: postMessage. Headless: deferred.
   */
  waitForCode(state: string): Promise<string>

  /**
   * Cleanup any resources (e.g., stop callback server).
   */
  dispose(): Promise<void>
}
```

### 1.2 Define `HeadlessAuthStrategy`

**[NEW] `packages/core/src/mcp/headless-auth-strategy.ts`**

The default strategy for core. Does not open browsers or start servers. Instead:
- `handleAuthorization()` → no-op (the URL is returned via `startAuth()` response)
- `waitForCode()` → returns a deferred promise that resolves when `resolveCode()` is called
- `resolveCode()` → called internally by `finishAuth()` to complete the flow

```typescript
export class HeadlessAuthStrategy implements McpAuthStrategy {
  readonly redirectUri: string
  private pending = new Map<string, {
    resolve: (code: string) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  constructor(redirectUri?: string) {
    // OOB redirect for headless mode — actual redirect is handled by client
    this.redirectUri = redirectUri ?? 'urn:ietf:wg:oauth:2.0:oob'
  }

  async handleAuthorization(_url: URL): Promise<void> {
    // No-op — URL is returned to caller via startAuth()
  }

  waitForCode(state: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(state)
        reject(new Error('OAuth callback timeout — authorization took too long'))
      }, 5 * 60 * 1000)
      this.pending.set(state, { resolve, reject, timeout })
    })
  }

  /** Called by MCP.finishAuth() to resolve the pending waitForCode() */
  resolveCode(state: string, code: string): boolean {
    const p = this.pending.get(state)
    if (!p) return false
    clearTimeout(p.timeout)
    this.pending.delete(state)
    p.resolve(code)
    return true
  }

  async dispose(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout)
      p.reject(new Error('Auth strategy disposed'))
    }
    this.pending.clear()
  }
}
```

### 1.3 Refactor `McpOAuthProvider`

**[MODIFY] `packages/core/src/mcp/oauth-provider.ts`**

| Before | After |
|--------|-------|
| Hardcoded `OAUTH_CALLBACK_PORT` / `OAUTH_CALLBACK_PATH` | Uses `strategy.redirectUri` |
| Constructor takes `callbacks: McpOAuthCallbacks` | Constructor takes `strategy: McpAuthStrategy` |
| `redirectToAuthorization()` calls `callbacks.onRedirect()` | Calls `strategy.handleAuthorization()` |
| Exports `OAUTH_CALLBACK_PORT` / `OAUTH_CALLBACK_PATH` | Removed |

Key changes:
```typescript
export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private strategy: McpAuthStrategy,     // ← replaces callbacks
  ) {}

  get redirectUrl(): string {
    return this.strategy.redirectUri        // ← from strategy
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    await this.strategy.handleAuthorization(url)  // ← delegated
  }
}
```

**DCR Invalidation:** Add a check in `clientInformation()` — if the stored `entry.redirectUri` differs from `this.strategy.redirectUri`, return `undefined` to force re-registration:
```typescript
async clientInformation(): Promise<OAuthClientInformation | undefined> {
  const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
  if (entry?.clientInfo) {
    // Invalidate DCR if redirect URI changed (different client environment)
    if (entry.redirectUri && entry.redirectUri !== this.strategy.redirectUri) {
      log.info('redirect URI changed, invalidating client registration', {
        mcpName: this.mcpName,
        stored: entry.redirectUri,
        current: this.strategy.redirectUri,
      })
      return undefined
    }
    // ... existing expiry checks
  }
}
```

### 1.4 Refactor `MCP` Namespace (Core Entry Point)

**[MODIFY] `packages/core/src/mcp/index.ts`**

#### Changes:

1. **Remove:** `import open from 'open'` — no browser from core.

2. **Remove:** `BrowserOpenFailed` event — dead code after decoupling. Rename to `AuthorizationPending` (a notification event, not an error event):
   ```typescript
   export const AuthorizationPending = BusEvent.define(
     'mcp.auth.authorization_pending',
     z.object({
       server: z.string(),
       url: z.string(),
       state: z.string(),
     }),
   )
   ```

3. **Add strategy registry:**
   ```typescript
   let defaultStrategy: McpAuthStrategy = new HeadlessAuthStrategy()

   export function setAuthStrategy(strategy: McpAuthStrategy): void {
     defaultStrategy = strategy
   }
   ```

4. **Refactor `startAuth()`:**
   ```typescript
   export async function startAuth(
     mcpName: string,
     options?: { strategy?: McpAuthStrategy; redirectUri?: string }
   ): Promise<{
     url: string
     method: 'code'
     instructions: string
     state: string
   }>
   ```
   - Uses `options.strategy ?? defaultStrategy`
   - Returns `state` so the client can echo it back in `finishAuth()`
   - Publishes `AuthorizationPending` event
   - Does NOT open browser, does NOT start callback server

5. **Refactor `finishAuth()`:**
   ```typescript
   export async function finishAuth(
     mcpName: string,
     code: string,
     state: string,       // ← REQUIRED for CSRF validation
   ): Promise<Status>
   ```
   - Validates `state` against `McpAuth.getOAuthState(mcpName)`
   - Throws structured error on mismatch

6. **Refactor `authenticate()`:**
   ```typescript
   export async function authenticate(
     mcpName: string,
     options?: { strategy?: McpAuthStrategy }
   ): Promise<Status>
   ```
   - Calls `startAuth()` → `strategy.waitForCode(state)` → `finishAuth(code, state)`
   - This is a convenience method; clients can call `startAuth/finishAuth` manually

7. **Add auth flow lock** — prevent concurrent flows for the same server:
   ```typescript
   const authLocks = new Map<string, Promise<Status>>()
   ```

8. **Update `create()`** — pass strategy to `McpOAuthProvider` instead of callbacks.

### 1.5 Delete Callback Server from Core

**[DELETE] `packages/core/src/mcp/oauth-callback.ts`**

This file's functionality will be relocated to `packages/cli` in Phase 2.

### 1.6 Add `redirectUri` to `McpAuth.Entry`

**[MODIFY] `packages/core/src/mcp/auth.ts`**

Add `redirectUri?: string` to the `Entry` schema to track which redirect URI was used during DCR:
```typescript
export const Entry = z.object({
  tokens: Tokens.optional(),
  clientInfo: ClientInfo.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(),
  redirectUri: z.string().optional(),   // ← NEW: tracks DCR redirect URI
})
```

### 1.7 Update HTTP Routes

**[MODIFY] `packages/core/src/server/routes/mcp.ts`**

| Route | Before | After |
|-------|--------|-------|
| `POST /:name/auth` | Returns `{ authorizationUrl }` | Returns `{ url, method, instructions, state }` |
| `POST /:name/auth/callback` | Body: `{ code }` | Body: `{ code, state }` |
| `POST /:name/auth/authenticate` | Opens browser + waits | **Remove** — headless core cannot orchestrate browser |

### 1.8 Update Tests

**[MODIFY] `packages/core/test/mcp/oauth-browser.test.ts`**

Complete rewrite. Tests now verify:
- `startAuth()` returns `{ url, method, instructions, state }`
- `finishAuth(name, code, state)` validates state and completes flow
- `finishAuth()` with wrong state throws CSRF error
- `authenticate()` with a mock strategy works end-to-end

**[MODIFY] `packages/core/test/mcp/oauth-auto-connect.test.ts`**

Update to pass strategy to `McpOAuthProvider` constructor instead of callbacks.

### Phase 1 Verification

```bash
bun typecheck
bun lint:fix
bun test test/mcp
```

---

## Phase 2 — CLI Auth Strategy

> **Goal:** Restore `liteai mcp auth` using the strategy pattern.  
> **Breaking:** No — restores previously broken functionality.  
> **Estimated files changed:** 3

### 2.1 Create `BrowserAuthStrategy`

**[NEW] `packages/cli/src/cli/auth/browser-auth-strategy.ts`**

This is a relocated + refactored version of the deleted `oauth-callback.ts`:

```typescript
import open from 'open'
import { type McpAuthStrategy } from '@liteai/core/mcp/auth-strategy'

const CALLBACK_PORT = 19876
const CALLBACK_PATH = '/mcp/oauth/callback'

export class BrowserAuthStrategy implements McpAuthStrategy {
  readonly redirectUri = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`
  private server: ReturnType<typeof Bun.serve> | undefined
  private pending = new Map<string, {
    resolve: (code: string) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  async handleAuthorization(url: URL): Promise<void> {
    await this.ensureServerRunning()
    try {
      const subprocess = await open(url.toString())
      // Listen for spawn errors (headless environments)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 500)
        subprocess.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })
        subprocess.on('exit', (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Browser open failed with exit code ${code}`))
          }
        })
      })
    } catch {
      // Browser failed — the CLI layer will detect this and print
      // the URL for manual action via the BrowserOpenFailed callback
      throw new Error(`Could not open browser. Open manually: ${url}`)
    }
  }

  waitForCode(state: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(state)
        reject(new Error('OAuth callback timeout'))
      }, 5 * 60 * 1000)
      this.pending.set(state, { resolve, reject, timeout })
    })
  }

  async dispose(): Promise<void> {
    if (this.server) {
      this.server.stop()
      this.server = undefined
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout)
      p.reject(new Error('Auth strategy disposed'))
    }
    this.pending.clear()
  }

  private async ensureServerRunning(): Promise<void> {
    if (this.server) return
    this.server = Bun.serve({
      port: CALLBACK_PORT,
      fetch: (req) => this.handleCallback(req),
    })
  }

  private handleCallback(req: Request): Response {
    const url = new URL(req.url)
    if (url.pathname !== CALLBACK_PATH) {
      return new Response('Not found', { status: 404 })
    }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (!state) return this.errorPage('Missing state parameter')
    if (error) {
      this.rejectPending(state, new Error(error))
      return this.errorPage(error)
    }
    if (!code) return this.errorPage('No authorization code')

    const p = this.pending.get(state)
    if (!p) return this.errorPage('Invalid or expired state')

    clearTimeout(p.timeout)
    this.pending.delete(state)
    p.resolve(code)
    return this.successPage()
  }

  // ... HTML success/error pages (moved from oauth-callback.ts)
}
```

### 2.2 Update CLI MCP Auth Command

**[MODIFY] `packages/cli/src/cli/cmd/mcp.ts`**

```typescript
// Before:
const status = await MCP.authenticate(serverName)

// After:
import { BrowserAuthStrategy } from '../auth/browser-auth-strategy'

const strategy = new BrowserAuthStrategy()
try {
  const status = await MCP.authenticate(serverName, { strategy })
  // ... handle status
} finally {
  await strategy.dispose()
}
```

Key changes to `McpAuthCommand`:
1. Remove `Bus.subscribe(MCP.BrowserOpenFailed, ...)` — the strategy handles browser errors directly
2. Wrap strategy creation and disposal in try/finally
3. Handle the `handleAuthorization` error by printing the URL to the terminal:
   ```typescript
   try {
     const status = await MCP.authenticate(serverName, { strategy })
   } catch (err) {
     if (err.message.includes('Could not open browser')) {
       // Extract URL from the startAuth response and show it
       spinner.stop('Could not open browser')
       prompts.log.warn('Please open this URL in your browser:')
       prompts.log.info(/* url */)
     }
   }
   ```

### 2.3 Update CLI Debug Command

**[MODIFY] `packages/cli/src/cli/cmd/mcp.ts`** — `McpDebugCommand`

Update the debug command to use `BrowserAuthStrategy` when creating `McpOAuthProvider` for diagnostic connections.

### Phase 2 Verification

```bash
# In packages/cli
bun typecheck
bun lint:fix

# Manual test
bun run liteai mcp auth          # Interactive selection
bun run liteai mcp auth <name>   # Direct auth
bun run liteai mcp debug <name>  # Debug flow
```

---

## Phase 3 — Web Auth Strategy

> **Goal:** Enable OAuth authentication from the web UI.  
> **Breaking:** No — additive feature.  
> **Estimated files changed:** 5

### 3.1 Create Web Auth Strategy

**[NEW] `packages/core/src/mcp/web-auth-strategy.ts`**

The web strategy works differently — the browser IS the client. The flow:

1. User clicks "Authenticate" in the MCP settings UI
2. Web calls `POST /:name/auth` → gets back `{ url, state }`
3. Web opens the URL in a new tab/popup
4. IdP redirects back to the web app's callback route
5. Web extracts code from URL and calls `POST /:name/auth/callback` with `{ code, state }`

Since the strategy pattern is about what happens inside `packages/core`, the web needs a different model: a **two-step HTTP API** (which already exists as routes). The web doesn't need a custom `McpAuthStrategy` implementation inside core — it uses the HTTP routes directly.

However, the `redirectUri` needs to be configurable per-request:

```typescript
// No new strategy needed in core for web.
// The web client calls startAuth() via HTTP with a redirectUri option.
```

### 3.2 Update HTTP Route for `redirectUri` Passthrough

**[MODIFY] `packages/core/src/server/routes/mcp.ts`**

Update `POST /:name/auth` to accept an optional `redirectUri` in the body:

```typescript
.post(
  '/:name/auth',
  validator('json', z.object({
    redirectUri: z.string().url().optional()
      .describe('OAuth redirect URI for the calling client environment'),
  }).optional()),
  async (c) => {
    const body = c.req.valid('json')
    const result = await MCP.startAuth(name, {
      redirectUri: body?.redirectUri,
    })
    return c.json(result)
  },
)
```

### 3.3 Add OAuth Callback Route to Web

**[NEW] `packages/web/src/pages/mcp-oauth-callback.tsx`**

A dedicated page that the IdP redirects to:

```tsx
// Route: /mcp/oauth/callback?code=xxx&state=yyy
export function McpOAuthCallback() {
  const params = useSearchParams()
  const sdk = useSDK()

  onMount(async () => {
    const code = params.code
    const state = params.state
    if (!code || !state) { /* show error */ return }

    // Extract server name from stored state mapping
    const serverName = sessionStorage.getItem(`mcp-oauth-state:${state}`)
    if (!serverName) { /* show error: unknown state */ return }

    await sdk.client.project.mcp.auth.callback({
      name: serverName,
      projectID: sdk.projectID,
      code,
      state,
    })

    // Show success, auto-close popup after 2 seconds
    sessionStorage.removeItem(`mcp-oauth-state:${state}`)
  })
}
```

### 3.4 Add "Authenticate" Button to Web MCP Settings

**[MODIFY] `packages/web/src/components/settings-mcp.tsx`**

For servers with `status === 'needs_auth'`, render an "Authenticate" button:

```tsx
<Show when={status() === 'needs_auth'}>
  <Button
    variant="secondary"
    size="sm"
    onClick={async () => {
      // 1. Call startAuth API
      const result = await sdk.client.project.mcp.auth.start({
        name: item.name,
        projectID: props.projectID,
        redirectUri: `${window.location.origin}/mcp/oauth/callback`,
      })

      // 2. Store state → server mapping for the callback page
      sessionStorage.setItem(
        `mcp-oauth-state:${result.state}`,
        item.name,
      )

      // 3. Open the authorization URL in a popup
      window.open(result.url, '_blank', 'width=600,height=700')
    }}
  >
    {language.t('mcp.action.authenticate')}
  </Button>
</Show>
```

### 3.5 Add i18n Keys

**[MODIFY] `packages/web/src/i18n/en.ts`** (and all other locales):

```typescript
'mcp.action.authenticate': 'Authenticate',
'mcp.oauth.callback.success': 'Authorization successful. You can close this window.',
'mcp.oauth.callback.error': 'Authorization failed',
```

### Phase 3 Verification

```bash
# In packages/web
bun typecheck
bun lint:fix

# Manual test
# 1. Open web UI → Settings → MCP
# 2. Add a remote MCP server with OAuth
# 3. Click "Authenticate" → should open popup
# 4. Complete OAuth → popup closes → status updates to "connected"
```

---

## Phase 4 — VSCode Auth Strategy (Optional)

> **Goal:** Enable OAuth authentication from the VSCode extension.  
> **Breaking:** No — additive feature.  
> **Difficulty:** Medium — depends on VSCode URI handler support.  
> **Estimated files changed:** 3

### 4.1 Assessment

Currently, `packages/vscode` has **no MCP-specific code** — it communicates with core entirely through the embedded web view and SDK HTTP client. Two approaches:

**Option A: Piggyback on Web Strategy**  
Since VSCode hosts the LiteAI web UI in a webview, the web's OAuth flow (Phase 3) may work as-is if the webview can open external URLs. The callback would need to be handled differently (webview can't receive browser redirects).

**Option B: Native VSCode URI Handler**  
Register a `vscode://liteai.liteai/mcp/oauth` URI handler. When the IdP redirects here, VSCode opens and the extension extracts the code.

### 4.2 Recommended: Option A with VSCode Bridge

Leverage the existing `webview-bridge.ts` to forward the OAuth flow:

**[MODIFY] `packages/vscode/src/webview-bridge.ts`**

Add a message handler for `mcp.auth.openUrl`:
```typescript
case 'mcp.auth.openUrl':
  vscode.env.openExternal(vscode.Uri.parse(message.url))
  break
```

**[MODIFY] `packages/vscode/src/extension.ts`**

Register a URI handler for the OAuth callback:
```typescript
vscode.window.registerUriHandler({
  handleUri(uri: vscode.Uri) {
    if (uri.path.startsWith('/mcp/oauth')) {
      const code = uri.query.match(/code=([^&]+)/)?.[1]
      const state = uri.query.match(/state=([^&]+)/)?.[1]
      if (code && state) {
        // Forward to the webview or call finishAuth via SDK
      }
    }
  },
})
```

**[MODIFY] `packages/web/src/components/settings-mcp.tsx`**

Detect VSCode environment and use bridge instead of `window.open`:
```typescript
if (isVscode()) {
  bridge.postMessage({ type: 'mcp.auth.openUrl', url: result.url })
} else {
  window.open(result.url, '_blank', 'width=600,height=700')
}
```

### Phase 4 Verification

```bash
# In packages/vscode
bun typecheck

# Manual test
# 1. Open VSCode with LiteAI extension
# 2. Go to MCP settings → Click Authenticate
# 3. External browser opens → Complete OAuth
# 4. VSCode receives callback → Status updates
```

---

## Phase 5 — Cleanup & Hardening

> **Goal:** Address all edge cases, security concerns, and dead code.  
> **Breaking:** No.  
> **Estimated files changed:** 5

### 5.1 Concurrent Auth Flow Protection

**[MODIFY] `packages/core/src/mcp/index.ts`**

Add a per-server lock to prevent overlapping auth flows:

```typescript
const authLocks = new Map<string, Promise<Status>>()

export async function authenticate(mcpName: string, options?: { strategy?: McpAuthStrategy }): Promise<Status> {
  const existing = authLocks.get(mcpName)
  if (existing) {
    log.info('auth already in progress, waiting', { mcpName })
    return existing
  }

  const promise = authenticateImpl(mcpName, options)
  authLocks.set(mcpName, promise)
  try {
    return await promise
  } finally {
    authLocks.delete(mcpName)
  }
}
```

### 5.2 DCR Invalidation on Redirect URI Change

**[MODIFY] `packages/core/src/mcp/oauth-provider.ts`**

In `saveClientInformation()`, persist the current `redirectUri`:
```typescript
async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
  await McpAuth.updateClientInfo(this.mcpName, {
    clientId: info.client_id,
    clientSecret: info.client_secret,
    clientIdIssuedAt: info.client_id_issued_at,
    clientSecretExpiresAt: info.client_secret_expires_at,
  }, this.serverUrl, this.strategy.redirectUri)  // ← also persist redirectUri
}
```

### 5.3 State Parameter TTL and Cleanup

**[MODIFY] `packages/core/src/mcp/auth.ts`**

Add timestamp to OAuth state entries and a cleanup function:
```typescript
export async function updateOAuthState(mcpName: string, oauthState: string): Promise<void> {
  const entry = (await get(mcpName)) ?? {}
  entry.oauthState = oauthState
  entry.oauthStateCreatedAt = Date.now()  // ← NEW
  await set(mcpName, entry)
}

/** Reject states older than 10 minutes */
export async function isOAuthStateValid(mcpName: string, state: string): Promise<boolean> {
  const entry = await get(mcpName)
  if (!entry?.oauthState || entry.oauthState !== state) return false
  if (entry.oauthStateCreatedAt && Date.now() - entry.oauthStateCreatedAt > 10 * 60 * 1000) {
    return false
  }
  return true
}
```

### 5.4 Remove Dead Code

- **Delete** `BrowserOpenFailed` event from core (replaced by `AuthorizationPending`)
- **Remove** `open` from `packages/core/package.json` dependencies
- **Remove** unused `McpOAuthCallbacks` type from `oauth-provider.ts`
- **Clean up** any remaining references to `OAUTH_CALLBACK_PORT` / `OAUTH_CALLBACK_PATH` in core

### 5.5 Update `packages/core/package.json`

Remove `open` dependency:
```diff
  "dependencies": {
-   "open": "^10.x",
  }
```

### Phase 5 Verification

```bash
bun typecheck
bun lint:fix
bun test test/mcp
```

---

## Dependency Graph

```
Phase 1 (Core Headless)
    │
    ├── Phase 2 (CLI Strategy)      ← Restores CLI auth
    │
    ├── Phase 3 (Web Strategy)      ← Adds web auth
    │       │
    │       └── Phase 4 (VSCode)    ← Optional, depends on web
    │
    └── Phase 5 (Hardening)         ← Can run in parallel with 2/3/4
```

Phases 2, 3, and 5 can be developed in parallel after Phase 1. Phase 4 depends on Phase 3.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| CLI auth broken between Phase 1 & 2 | Medium | Execute phases 1+2 in the same PR |
| PKCE verifier lost between transports | High | Verify verifier is persisted to `McpAuth` before transport swap |
| IdP rejects changed redirect_uri | Medium | DCR invalidation in Phase 5.2 forces re-registration |
| Web popup blocked by browser | Low | Detect and show inline fallback URL |
| VSCode webview can't open external URLs | Low | Use `vscode.env.openExternal()` bridge |

---

## File Change Summary

| Phase | New Files | Modified Files | Deleted Files | Total |
|-------|-----------|----------------|---------------|-------|
| 1 | 2 | 5 | 1 | 8 |
| 2 | 1 | 1 | 0 | 2 |
| 3 | 1 | 3 | 0 | 4 |
| 4 | 0 | 3 | 0 | 3 |
| 5 | 0 | 4 | 0 | 4 |
| **Total** | **4** | **16** | **1** | **21** |
