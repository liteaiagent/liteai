# LiteAI API Node — Configuration Guide

> All the ways to configure the server: environment variables, user settings file, and runtime API.

---

## Configuration Precedence

Settings are resolved in this order (highest priority first):

1. **Runtime overrides** — `PATCH /v1/settings` (in-memory, lost on restart)
2. **Environment variables** — set before starting the server
3. **User settings file** — `~/.liteai/liteai.json`
4. **Built-in defaults** — hardcoded fallbacks

---

## User Settings File

Path: `~/.liteai/liteai.json`

Created automatically on first run with sensible defaults:

```json
{
  "$schema": "https://lite-agent.dev/schemas/liteai.json",
  "model": {
    "default": "gemini-2.5-flash",
    "aliases": {},
    "thinking_budget": null,
    "temperature": null
  },
  "server": {
    "host": "0.0.0.0",
    "port": 9000
  }
}
```

### Model Settings

| Field | Type | Default | Description |
|---|---|---|---|
| `default` | string | `"gemini-2.5-flash"` | Default model when none is specified in the request |
| `aliases` | object | `{}` | Custom model aliases (e.g. `{"my-model": "gemini-2.5-pro"}`) |
| `thinking_budget` | number \| null | `null` | Global thinking token budget (falls back to `8192`) |
| `temperature` | number \| null | `null` | Global temperature override |

### Server Settings

| Field | Type | Default | Description |
|---|---|---|---|
| `host` | string | `"0.0.0.0"` | Listen address |
| `port` | number | `9000` | Listen port |

---

## Environment Variables

### Server

| Variable | Default | Description |
|---|---|---|
| `HOST` | from settings file | Listen address |
| `PORT` | from settings file | Listen port |
| `LOG_LEVEL` | `INFO` | Console log level: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` |

### Authentication

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Google AI API key (enables `api-key` mode) |
| `GOOGLE_API_KEY` | — | Alternative API key variable |
| `GOOGLE_GENAI_USE_GCA` | — | Set `true` for OAuth/Code Assist mode |
| `GOOGLE_GENAI_USE_VERTEXAI` | — | Set `true` for Vertex AI mode |
| `GOOGLE_CLOUD_PROJECT` | — | GCP project ID |
| `GOOGLE_CLOUD_PROJECT_ID` | — | Alternative GCP project ID variable |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | GCP region for Vertex AI |
| `CLOUD_SHELL` | — | Set `true` to use Compute ADC |
| `GEMINI_CLI_USE_COMPUTE_ADC` | — | Set `true` to use Compute ADC |
| `GOOGLE_CLOUD_ACCESS_TOKEN` | — | Direct access token bypass (skips credential loading) |
| `GEMINI_CLI_CONFIG_DIR` | `~/.gemini` | Override Gemini CLI config directory |

### Model

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_MODEL` | from settings file | Default model for requests |
| `TEMPERATURE` | from settings file | Global temperature |
| `THINKING_BUDGET` | `8192` | Global thinking token budget |

### Code Assist

| Variable | Default | Description |
|---|---|---|
| `CODE_ASSIST_ENDPOINT` | `https://cloudcode-pa.googleapis.com` | Code Assist API endpoint |
| `CODE_ASSIST_API_VERSION` | `v1internal` | Code Assist API version |

### Client Auth

| Variable | Default | Description |
|---|---|---|
| `JWT_PUBLIC_KEY_API` | from `keys/api_public.pem` | RSA public key (PEM) for JWT verification |

### Advanced

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_GENAI_API_VERSION` | — | API version override (e.g. `v1`, `v1alpha`) |
| `GEMINI_API_KEY_AUTH_MECHANISM` | `x-goog-api-key` | Auth header: `x-goog-api-key` or `bearer` |
| `GEMINI_CLI_CUSTOM_HEADERS` | — | JSON map of custom headers |
| `HTTPS_PROXY` / `HTTP_PROXY` | — | HTTP/HTTPS proxy URL |
| `OVERAGE_STRATEGY` | `never` | AI credits strategy: `ask`, `always`, `never` |
| `LITEAI_DATA_DIR` | `~/.liteai` | Override data directory for telemetry |

---

## Runtime Settings API

You can change settings at runtime without restarting the server.

### Get Current Settings

```bash
curl http://localhost:9000/v1/settings \
  -H "Authorization: Bearer <token>"
```

### Update Settings

```bash
curl -X PATCH http://localhost:9000/v1/settings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"default_model": "gemini-2.5-pro", "temperature": 0.5}'
```

Set a value to `null` to reset it to the file/env default:

```bash
curl -X PATCH http://localhost:9000/v1/settings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"temperature": null}'
```

### Persist to Disk

Save runtime overrides to `~/.liteai/liteai.json`:

```bash
curl -X POST http://localhost:9000/v1/settings/save \
  -H "Authorization: Bearer <token>"
```

### Reload from Disk

Discard runtime overrides and reload from file:

```bash
curl -X POST http://localhost:9000/v1/settings/reload \
  -H "Authorization: Bearer <token>"
```

---

## File Paths Reference

| Path | Purpose |
|---|---|
| `~/.liteai/liteai.json` | User settings (model, server) |
| `~/.gemini/oauth_creds.json` | OAuth credential cache (shared with Gemini CLI) |
| `~/.liteai/telemetry.jsonl` | Local telemetry log (JSONL) |
| `./logs/liteai-api-node.log` | Server log file |
| `./keys/api_public.pem` | RSA public key for JWT verification |
| `./keys/api_private.pem` | RSA private key for signing JWTs |
