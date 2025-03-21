# LiteAI API Node — Getting Started

> Get up and running with the LiteAI API Node server in minutes.

---

## What is LiteAI API Node?

LiteAI API Node is an **OpenAI-compatible API server** that proxies requests to Google Gemini models. It translates OpenAI-format chat completions into Gemini API calls, so any tool that speaks the OpenAI protocol (VS Code extensions, chat UIs, CLI tools) can use Gemini without modification.

**Key features:**
- OpenAI-compatible `/v1/chat/completions` endpoint (streaming and non-streaming)
- Automatic model alias resolution (`auto`, `pro`, `flash`, `flash-lite`)
- Reasoning/thinking support for Gemini 2.5+ and 3.x models
- Tool/function calling translation
- Multiple auth modes: OAuth (Code Assist), Vertex AI, API key, Compute ADC
- JWT-based client authentication
- Runtime-configurable settings
- Local telemetry logging

---

## Prerequisites

- **[Bun](https://bun.sh/)** v1.0 or later
- **Google account** with access to Gemini (via API key, Code Assist, or Vertex AI)

---

## Installation

```bash
# Clone the monorepo
git clone <repo-url>
cd liteai/apps/liteai-api-node

# Install dependencies
bun install
```

---

## Quick Start

### Option 1: API Key (simplest)

```bash
export GEMINI_API_KEY="your-api-key"
bun run dev
```

### Option 2: OAuth / Code Assist (recommended)

```bash
# If you've already authenticated with Gemini CLI:
bun run dev

# Otherwise, start the server and use the built-in login:
bun run dev
curl -X POST http://localhost:9000/auth/login
# → Open the authUrl in your browser
```

### Option 3: Vertex AI

```bash
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_PROJECT=my-project
gcloud auth application-default login
bun run dev
```

For full auth details, see the [Authentication Guide](./authentication.md).

---

## Generate API Keys

The server uses RS256 JWT tokens for client authentication on `/v1/*` routes. You need a key pair:

```bash
# Generate RSA key pair into the keys/ directory
bun scripts/keygen.ts keys
```

This creates:
- `keys/api_private.pem` — used to sign tokens (keep secret)
- `keys/api_public.pem` — embedded in the server for verification

> **Note:** If no public key is configured, the server will refuse to start.

---

## Verify It Works

```bash
# 1. Health check (no auth required)
curl http://localhost:9000/health

# 2. Check auth status
curl http://localhost:9000/auth/status

# 3. List models (requires Bearer token)
curl http://localhost:9000/v1/models \
  -H "Authorization: Bearer <your-jwt-token>"

# 4. Chat completion
curl http://localhost:9000/v1/chat/completions \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Run E2E Tests

With the server running:

```bash
bun run e2e/test-e2e.ts
```

The test suite auto-generates a JWT from `keys/api_private.pem` and tests health, models, streaming chat completions, error handling, and auth.

---

## Project Structure

```
liteai-api-node/
├── src/
│   ├── index.ts              # Server entry point (Hono + Bun)
│   ├── content-generator.ts  # SDK & Code Assist content generators
│   ├── api-keys.ts           # JWT verification (RS256)
│   ├── eval-hooks.ts         # LLM call instrumentation hooks
│   ├── auth/                 # Auth detection, credentials, Code Assist client
│   ├── core/                 # Config, models, converter, logger, billing
│   ├── routes/               # API route handlers
│   ├── models/               # Request/response schemas (Zod)
│   └── keys/                 # Embedded public key
├── e2e/                      # End-to-end tests
├── keys/                     # RSA key pair (gitignored)
├── logs/                     # Server log files
└── docs/user-guide/          # This documentation
```

---

## What's Next?

- [Configuration](./configuration.md) — Environment variables, user settings, runtime overrides
- [Models](./models.md) — Supported models, aliases, thinking/reasoning config
- [API Reference](./api-reference.md) — Full route documentation
- [Authentication](./authentication.md) — Auth modes, OAuth flow, credential storage
- [Troubleshooting](./troubleshooting.md) — Common issues, logging, debugging
