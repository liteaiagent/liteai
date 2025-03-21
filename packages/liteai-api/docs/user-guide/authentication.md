# LiteAI API Node — Authentication Guide

> How to configure and use authentication in the LiteAI API Node server.
>
> See also: [Getting Started](./getting-started.md) · [Configuration](./configuration.md) · [Models](./models.md) · [API Reference](./api-reference.md) · [Troubleshooting](./troubleshooting.md)

---

## Auth Modes

The server detects the auth mode automatically from environment variables:

| Priority | Env Variable | Mode | Description |
|---|---|---|---|
| 1 | `GOOGLE_GENAI_USE_GCA=true` | `oauth` | OAuth via Google Code Assist (default) |
| 2 | `GOOGLE_GENAI_USE_VERTEXAI=true` | `vertex-ai` | Vertex AI with service account / ADC |
| 3 | `GEMINI_API_KEY=<key>` | `api-key` | Direct API key |
| 4 | `CLOUD_SHELL=true` or `GEMINI_CLI_USE_COMPUTE_ADC=true` | `compute-adc` | Compute ADC (Cloud Shell, GCE) |
| 5 | *(none)* | `oauth` | Defaults to OAuth |

Check the current mode:

```bash
curl http://localhost:9000/auth/status
```

---

## Auth Routes

All auth routes are **public** — no Bearer token required.

### `GET /auth/status`

Check the current authentication state.

**Response:**

```json
{
  "authenticated": true,
  "authMode": "oauth",
  "email": "user@example.com",
  "tier": "standard-tier",
  "projectId": "my-project-123",
  "credsPath": "/home/user/.gemini/oauth_creds.json"
}
```

| Field | Type | Description |
|---|---|---|
| `authenticated` | boolean | Whether valid credentials exist |
| `authMode` | string | Current auth mode |
| `email` | string? | User's email (if known) |
| `tier` | string? | Code Assist tier |
| `projectId` | string? | Google Cloud project |
| `credsPath` | string | Path to credential cache file |

---

### `POST /auth/login`

Start an interactive OAuth login flow. This:

1. Starts a local HTTP callback server on a random port
2. Generates a PKCE challenge
3. Returns the Google auth URL for the user to open

**Response:**

```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "callbackPort": 54321
}
```

**Frontend usage:**

```javascript
// 1. Start the login flow
const res = await fetch("http://localhost:9000/auth/login", { method: "POST" });
const { authUrl } = await res.json();

// 2. Open the auth URL in user's browser
window.open(authUrl);

// 3. Poll status until authenticated
const poll = setInterval(async () => {
  const status = await fetch("http://localhost:9000/auth/status").then(r => r.json());
  if (status.authenticated) {
    clearInterval(poll);
    console.log("Logged in as", status.email);
  }
}, 2000);
```

**What happens under the hood:**

1. User opens `authUrl` in browser → Google consent screen
2. After consent, Google redirects to `http://localhost:<callbackPort>?code=...`
3. Server exchanges the code for tokens and caches them
4. User sees "✅ Authenticated!" in browser and can close the tab

> **Note:** The callback server auto-closes after 5 minutes if login doesn't complete.

> **Note:** Only available in `oauth` mode. Returns 400 in other modes.

---

### `POST /auth/login/code`

Manual auth code exchange — for environments where the browser callback can't reach the server (e.g., remote SSH).

**Request:**

```json
{ "code": "4/0AYGS..." }
```

**Response:**

```json
{
  "authenticated": true,
  "email": "user@example.com"
}
```

To get the code manually:

1. Open the auth URL manually (from `POST /auth/login` or generate one)
2. After consent, Google shows a code on screen
3. Copy the code and send it via this endpoint

---

### `POST /auth/logout`

Clear cached OAuth credentials and reset all auth state.

**Response:**

```json
{
  "success": true,
  "credentialsRemoved": true
}
```

After logout, the next API call requiring auth will fail until the user re-authenticates.

---

## Quick Setup Flows

### API Key (simplest)

```bash
export GEMINI_API_KEY="your-api-key"
npm run dev
```

No login needed — the server uses the API key directly.

### OAuth (Code Assist)

```bash
# Option A: Reuse existing Gemini CLI credentials
gemini   # authenticates and caches tokens
npm run dev

# Option B: Use the server's built-in login
npm run dev
curl -X POST http://localhost:9000/auth/login
# → open the authUrl in your browser
```

### Vertex AI

```bash
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_PROJECT=my-project
gcloud auth application-default login
npm run dev
```

### Compute ADC (Cloud Shell / GCE)

```bash
# Automatic in Cloud Shell
export CLOUD_SHELL=true
npm run dev

# Or explicit
export GEMINI_CLI_USE_COMPUTE_ADC=true
npm run dev
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI API key |
| `GOOGLE_GENAI_USE_GCA` | Set to `true` for OAuth/Code Assist mode |
| `GOOGLE_GENAI_USE_VERTEXAI` | Set to `true` for Vertex AI mode |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | GCP region (default: `us-central1`) |
| `CLOUD_SHELL` | Set to `true` to use Compute ADC |
| `GEMINI_CLI_USE_COMPUTE_ADC` | Set to `true` to use Compute ADC |
| `GOOGLE_CLOUD_ACCESS_TOKEN` | Direct access token bypass (skips credential loading) |
| `GEMINI_CLI_CONFIG_DIR` | Override config dir (default: `~/.gemini`) |

---

## Credential Storage

OAuth credentials are cached at `~/.gemini/oauth_creds.json` (same location as Gemini CLI). This means:

- **Tokens are shared** — authenticating via `gemini` CLI works for this server too
- **Tokens auto-refresh** — expired access tokens are refreshed automatically using the refresh token
- **Permissions match** — file is written with `chmod 600` on Unix systems

---

## See Also

- [Getting Started](./getting-started.md) — Installation and first steps
- [Configuration](./configuration.md) — All environment variables and settings
- [Models](./models.md) — Supported models and thinking config
- [API Reference](./api-reference.md) — Full route documentation
- [Troubleshooting](./troubleshooting.md) — Auth issues and debugging
