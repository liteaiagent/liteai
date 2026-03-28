# GCA Proxy — Troubleshooting

> Common issues, debugging tips, and how to read the logs.

---

## Logging

### Log Levels

Set via `LOG_LEVEL` env var (default: `INFO`):

| Level | What it shows |
|---|---|
| `TRACE` | Full request/response payloads |
| `DEBUG` | Detailed internal state, SSE chunk counts |
| `INFO` | Startup, requests, auth mode |
| `WARN` | Recoverable issues |
| `ERROR` | Failures |

### Log Outputs

- **Console** — follows `LOG_LEVEL`
- **File** — always captures `DEBUG`+ to `./logs/gca-proxy.log`

### Request Correlation

Each request gets a short ID (e.g. `[a1b2c3d4]`) that appears in all log lines for that request, making it easy to trace a single request through the log file.

### Log Format

```
HH:MM:SS LEVEL  module [reqId] -- message key=value
```

Example:
```
14:23:45 INFO  routes.chat_completions [a1b2c3d4] -- Chat completion: model=auto→gemini-3-pro-preview stream=true messages=3
14:23:45 DEBUG routes.chat_completions [a1b2c3d4] -- SSE chunk #1: reasoning (128 chars)
14:23:46 DEBUG routes.chat_completions [a1b2c3d4] -- SSE chunk #2: content (45 chars)
14:23:46 DEBUG routes.chat_completions [a1b2c3d4] -- SSE stream complete: 2 chunks emitted
```

---

## Common Issues

### Server won't start: "JWT public key is not configured"

The server requires an RSA public key for client authentication.

**Fix:**
```bash
# Generate keys
bun scripts/keygen.ts keys

# Or set via env var
export JWT_PUBLIC_KEY_API="-----BEGIN PUBLIC KEY-----\n..."
```

---

### 401 Unauthorized on `/v1/*` routes

All `/v1/*` routes require a Bearer token (RS256 JWT signed with the matching private key).

**Fix:**
```bash
# Generate a test token
bun scripts/keygen.ts keys  # if keys don't exist

# Use the private key to sign a JWT, or set LITEAI_API_KEY
export LITEAI_API_KEY="<your-jwt>"
```

---

### 401 "OAuth credentials have expired"

OAuth access tokens expire after ~1 hour. The server auto-refreshes them using the refresh token, but if the refresh token is also invalidated (e.g. Google session revoked), you need to re-authenticate.

**Fix:**
```bash
# Re-login via the server
curl -X POST http://localhost:9000/auth/login
# → Open the authUrl in your browser

# Or re-authenticate via Gemini CLI
gemini
```

---

### Streaming responses hang or time out

The server sends SSE keepalive comments (`: keepalive`) every 5 seconds to prevent proxy/client timeouts while the model is thinking.

If you're behind a reverse proxy (nginx, Cloudflare, etc.), ensure it:
- Does **not** buffer SSE responses (add `X-Accel-Buffering: no`)
- Has a long enough read timeout (≥60s for thinking models)

The Bun server is configured with `idleTimeout: 0` to prevent Bun from closing long-running SSE connections.

---

### "Invalid stream" errors

The server validates the upstream Gemini stream. Common validation errors:

| Error | Meaning |
|---|---|
| `NO_FINISH_REASON` | Model stream ended without a finish reason |
| `MALFORMED_FUNCTION_CALL` | Model returned an invalid tool call |
| `NO_RESPONSE_TEXT` | Model stream ended with empty response |

These are retried automatically by the Code Assist client (up to 3 retries with exponential backoff for transient errors).

---

### Model not found

If a model ID isn't recognized, check:
1. Spelling — model IDs are case-sensitive
2. Available aliases — use `GET /v1/models` to see the list
3. Custom aliases — check `~/.liteai/liteai.json` → `model.aliases`

---

### Thinking/reasoning not appearing

1. Ensure you're using a Gemini 2.5+ or 3.x model
2. Check that `thinking_budget` > 0 (default: `8192`)
3. If using `reasoning_effort`, verify it's not set to `"none"`
4. In streaming, reasoning appears in `delta.reasoning_content` (not `delta.content`)

---

## Telemetry

Every LLM request is logged to `~/.liteai/telemetry.jsonl` as a JSON line:

```json
{
  "timestamp": "2024-01-15T14:23:45.678Z",
  "model": "gemini-2.5-flash",
  "traceId": "abc123",
  "latencyMs": 1234,
  "tokens": {
    "prompt": 150,
    "completion": 42,
    "total": 192,
    "thinking": 85
  },
  "finishReason": "STOP",
  "stream": true
}
```

This is fire-and-forget — telemetry never blocks or crashes the server.

### Analyze Telemetry

```bash
# View the last 10 requests
tail -10 ~/.liteai/telemetry.jsonl | jq .

# Average latency
cat ~/.liteai/telemetry.jsonl | jq -s '[.[].latencyMs] | add / length'

# Count by model
cat ~/.liteai/telemetry.jsonl | jq -s 'group_by(.model) | map({model: .[0].model, count: length})'
```

---

## Debug Checklist

When something isn't working:

1. **Check health:** `curl http://localhost:9000/health`
2. **Check auth status:** `curl http://localhost:9000/auth/status`
3. **Check the log file:** `tail -100 ./logs/gca-proxy.log`
4. **Enable debug logging:** `LOG_LEVEL=DEBUG bun run dev`
5. **Enable trace logging:** `LOG_LEVEL=TRACE bun run dev` (shows full payloads)
6. **Check telemetry:** `tail -5 ~/.liteai/telemetry.jsonl | jq .`
7. **Run E2E tests:** `bun run e2e/test-e2e.ts`
