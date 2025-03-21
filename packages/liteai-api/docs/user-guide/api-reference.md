# LiteAI API Node — API Routes Reference

> OpenAI-compatible API server powered by Google Gemini models.
>
> See also: [Getting Started](./getting-started.md) · [Configuration](./configuration.md) · [Models](./models.md) · [Authentication](./authentication.md) · [Troubleshooting](./troubleshooting.md)

## Base URL

```
http://localhost:9000
```

Port is configurable via `PORT` env var or `~/.liteai/liteai-api-node.json`.

---

## Public Routes

These routes require **no authentication**.

### `GET /health`

Health check.

```json
{ "status": "ok", "service": "liteai" }
```

### Auth Routes

See [Authentication Guide](./authentication.md) for full details.

| Route | Method | Description |
|---|---|---|
| `/auth/status` | GET | Check authentication state |
| `/auth/login` | POST | Start browser-based OAuth login |
| `/auth/login/code` | POST | Exchange auth code manually |
| `/auth/logout` | POST | Clear cached credentials |

---

## Protected Routes (`/v1/*`)

These routes are protected by **Bearer token** auth when `JWT_PUBLIC_KEY` is configured.
If no public key is set, auth is bypassed (dev mode).

```
Authorization: Bearer <token>
```

### Chat Completions

#### `POST /v1/chat/completions`

OpenAI-compatible chat completion endpoint. Supports both streaming and non-streaming.

**Request body:**

```json
{
  "model": "gemini-2.5-flash",
  "stream": true,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "top_p": 0.9,
  "stop": ["\n"],
  "tools": [],
  "tool_choice": "auto",
  "thinking_budget": 8192,
  "reasoning_effort": "medium"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | string | `"auto"` | Gemini model ID or alias |
| `stream` | boolean | `false` | SSE streaming vs JSON response |
| `messages` | array | *required* | Chat messages (system/user/assistant/tool roles) |
| `temperature` | number | from config | Sampling temperature |
| `max_tokens` | number | — | Max output tokens |
| `top_p` | number | — | Top-P sampling |
| `stop` | string/string[] | — | Stop sequences |
| `tools` | array | — | OpenAI-format tool definitions |
| `tool_choice` | string | — | `"auto"`, `"none"`, `"required"` |
| `thinking_budget` | number | `8192` | Token budget for model thinking |
| `reasoning_effort` | string | — | `"none"`, `"low"`, `"medium"`, `"high"` |

**Streaming response:** SSE with `data: {chunk}` events, ending with `data: [DONE]`.

**Non-streaming response:** Standard OpenAI chat completion JSON.

---

### Models

#### `GET /v1/models`

List available Gemini models.

```json
{
  "object": "list",
  "data": [
    { "id": "gemini-2.5-flash", "object": "model", "created": 0, "owned_by": "google" }
  ]
}
```

#### `GET /v1/models/:modelId`

Get details for a specific model. Supports model aliases.

---

### About

#### `GET /v1/about`

Server info and metadata.

```json
{
  "username": "user",
  "user_email": "user@example.com",
  "tier": "standard-tier",
  "version": "0.1.0",
  "node_version": "v22.0.0",
  "os_platform": "win32",
  "os_version": "10.0.26100",
  "default_model": "gemini-2.5-flash",
  "auth_mode": "oauth",
  "tools_enabled": false,
  "tracing_enabled": false,
  "mcp_servers": []
}
```

---

### Settings

#### `GET /v1/settings`

Get current model settings.

```json
{
  "default_model": "gemini-2.5-flash",
  "temperature": null,
  "thinking_budget": null,
  "top_p": null
}
```

#### `PATCH /v1/settings`

Update settings at runtime. Set a value to `null` to reset it.

```json
{ "default_model": "gemini-2.5-pro", "temperature": 0.5 }
```

#### `POST /v1/settings/save`

Persist runtime overrides to `~/.liteai/liteai-api-node.json`.

#### `POST /v1/settings/reload`

Reload settings from disk (clears runtime overrides).

---

### User Info

#### `GET /user_info`

> Note: Mounted at root, not under `/v1`.

Similar to `/v1/about` but includes the list of available models.

---

## Error Format

All errors follow the OpenAI error format:

```json
{
  "error": {
    "message": "Description of what went wrong",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

Error types: `invalid_request_error`, `authentication_error`, `server_error`, `not_found`.

---

## See Also

- [Getting Started](./getting-started.md) — Installation and first steps
- [Configuration](./configuration.md) — Environment variables and settings
- [Models](./models.md) — Supported models, aliases, thinking config
- [Authentication](./authentication.md) — Auth modes and OAuth flow
- [Troubleshooting](./troubleshooting.md) — Common issues and debugging
