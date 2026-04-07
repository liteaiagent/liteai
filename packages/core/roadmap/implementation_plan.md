# MCP OAuth Remote Decoupling Plan

This plan addresses the legacy design where `packages/core` assumes it runs locally on the user's graphical interface. The current approach uses the `open` library to trigger the OS browser and spins up `McpOAuthCallback` to listen on `127.0.0.1:19876`. Removing these assumptions ensures `core` acts purely as a headless backend API server, matching the paradigm established by the Code Assist Provider's `ProviderAuthService`.

## User Review Required

> [!WARNING]
> This is a **Breaking Change** for the CLI and Web interfaces. By moving browser execution and callback interception out of `packages/core`, you will need to update `packages/cli` and `packages/web` (and `vscode` if supporting MCP) to handle the `open` command and callback loopbacks themselves.
> The changes inside `core` will provide the headless building blocks: `startAuth` (returns the URL payload) and `finishAuth` (accepts the intercepted query parameters). 

> [!IMPORTANT]
> Since different clients will have different capabilities (Web vs CLI vs Desktop), `McpOAuthProvider` can no longer hardcode `127.0.0.1:19876` as its single `redirect_uri`. The `redirectUrl` must be passed dynamically from the clients during the initialization phase, so that the IdP redirects back to the client directly (e.g., `vscode://liteai/mcp/oauth`).

## Proposed Architecture Alignment (Code Assist Model)

Drawing from how the Code Assist `ProviderAuthService` behaves, the MCP OAuth flow will be inverted from a push execution (spawn a browser natively) to a pull execution (serve an authorization payload natively). 

### Core Transport Layer (`packages/core/src/mcp/oauth-provider.ts`)

Modify the OAuth provider to accept a dynamically configured redirect URI.

#### [MODIFY] oauth-provider.ts
- Remove `OAUTH_CALLBACK_PORT` and `OAUTH_CALLBACK_PATH` exports.
- Change the constructor signature of `McpOAuthProvider` to accept an optional `clientRedirectUrl: string`.
- Update `get redirectUrl()` to return `this.clientRedirectUrl` if provided, falling back to a sensible placeholder or throwing if dynamic registration requires it.
- Remove tight coupling with `McpOAuthCallback`.

---

### Core Entry APIs (`packages/core/src/mcp/index.ts`)

Adopt the `ProviderAuthService` payload shape for authorization triggers.

#### [MODIFY] index.ts
- Remove dependency on the `open` package.
- Remove `BrowserOpenFailed` entirely, as the browser management falls purely to the client.
- Update `startAuth(mcpName: string, redirectUrl?: string)` to generate state and return an authorization payload describing what the client should do:
  ```typescript
  return {
    url: authorizationUrl,
    method: "code", // Signifying the client must intercept/obtain the code manually 
    instructions: "Please authorize and return the code.",
    state: oauthState // Client must echo this back for CSRF checks
  }
  ```
- Deprecate/Remove `authenticate(mcpName: string)`. The orchestration code contained here will be moved to the client side.
- Update `finishAuth(mcpName: string, code: string, state: string)` to explicitly validate the passed `state` string against the internally cached `McpAuth.getOAuthState()`. 

---

### Core Loopback Server (`packages/core/src/mcp/oauth-callback.ts`)

Completely decommission this file from `packages/core`.

#### [DELETE] oauth-callback.ts
- The HTTP loopback listener has no place in the `packages/core` backend as it binds to local loopback ports which block true remote connectivity.
- A similar implementation of this listener will be ported up to `packages/cli` in the future for local CLI users, but it must not be in `core`.

## Open Questions

1. **Client Scope**: Should I just execute this change on `packages/core` for now (which will intentionally break `liteai mcp auth` via the CLI until the CLI is updated separately), or do you want me to also immediately implement the callback loopback interceptor directly in `packages/cli`?

## Verification Plan

### Automated Tests
- Fix `oauth-browser.test.ts` to reflect the new decoupled architecture. Instead of mocking the OS `open()` call, the test will directly call `startAuth()`, extract the generated URL/state, and simulate the IdP callback by explicitly calling `finishAuth(code, state)`.
- Run `bun test test/mcp` across the `core` package to ensure the auth payload shape passes successfully. 
