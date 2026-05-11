---
title: Troubleshoot installation and login
description: "Common issues with installing and authenticating LiteAI."
---

# Troubleshoot installation and login

## Installation issues

### `command not found: liteai`

The CLI binary is not in your PATH. Try:

```bash
# Verify installation
bun pm ls -g | grep @liteai/cli

# Reinstall globally
bun install -g @liteai/cli
```

### Port already in use

```
Error: Port 3000 is already in use
```

Another process is using the default port. Either stop it or use a different port:

```bash
liteai --port 3001
```

## Authentication issues

### Provider API key not found

```
Error: No API key found for provider "anthropic"
```

Ensure the key is set:

```bash
# Check environment
echo $ANTHROPIC_API_KEY

# Set it
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or add to `~/.liteai/settings.json`:

```json
{
  "provider": "anthropic"
}
```

The key should be in `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` depending on your provider.

### Invalid API key

Verify your key is valid by testing directly:

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

## What's next?

- [**Troubleshoot performance**](/build/troubleshoot-performance) — Performance issues
- [**Settings reference**](/configuration/settings) — Full configuration options
