# LiteAI API Node — Models Guide

> Supported Gemini models, aliases, and thinking/reasoning configuration.

---

## Available Models

### Gemini 2.5 (Stable)

| Model ID | Description |
|---|---|
| `gemini-2.5-pro` | Gemini 2.5 Pro — high capability |
| `gemini-2.5-flash` | Gemini 2.5 Flash — fast, cost-effective (server default) |
| `gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite — lightest |

### Gemini 3.x (Preview)

| Model ID | Description |
|---|---|
| `gemini-3-pro-preview` | Gemini 3 Pro Preview |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview |
| `gemini-3.1-pro-preview-customtools` | Gemini 3.1 Pro Preview (custom tools) |
| `gemini-3-flash-preview` | Gemini 3 Flash Preview |

---

## Model Aliases

Use shorter aliases instead of full model IDs:

| Alias | Resolves To |
|---|---|
| `auto` | `gemini-3-pro-preview` |
| `pro` | `gemini-3-pro-preview` |
| `flash` | `gemini-3-flash-preview` |
| `flash-lite` | `gemini-2.5-flash-lite` |
| `auto-gemini-3` | `gemini-3-pro-preview` |
| `auto-gemini-2.5` | `gemini-2.5-pro` |

### Custom Aliases

Add your own aliases in `~/.liteai/liteai.json`:

```json
{
  "model": {
    "aliases": {
      "my-fast": "gemini-2.5-flash",
      "my-smart": "gemini-3-pro-preview"
    }
  }
}
```

Custom aliases take precedence over built-in ones.

---

## Using Models in Requests

Specify the model in the `model` field of `/v1/chat/completions`:

```json
{
  "model": "flash",
  "messages": [{"role": "user", "content": "Hello!"}]
}
```

If `model` is omitted or empty, it defaults to `"auto"`.

### Setting a Default Model

1. **User settings file** (`~/.liteai/liteai.json`):
   ```json
   { "model": { "default": "gemini-2.5-flash" } }
   ```

2. **Environment variable**:
   ```bash
   export DEFAULT_MODEL=gemini-2.5-pro
   ```

3. **Runtime API**:
   ```bash
   curl -X PATCH http://localhost:9000/v1/settings \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"default_model": "gemini-2.5-pro"}'
   ```

---

## Thinking / Reasoning

Gemini 2.5+ and 3.x models support **thinking** — the model reasons through the problem before responding. Thinking tokens are returned separately from the response text.

### Thinking Budget

The thinking budget controls how many tokens the model can use for reasoning:

| Source | Default |
|---|---|
| Request `thinking_budget` field | — |
| Settings / env `THINKING_BUDGET` | `8192` |
| Built-in default | `8192` |

```json
{
  "model": "gemini-2.5-pro",
  "thinking_budget": 16384,
  "messages": [{"role": "user", "content": "Explain quantum entanglement"}]
}
```

### Reasoning Effort (Gemini 3.x only)

For Gemini 3.x models, you can use the `reasoning_effort` field as a simpler alternative to raw token budgets:

| Level | Token Budget |
|---|---|
| `none` | `0` |
| `low` | `1024` |
| `medium` | `8192` |
| `high` | `32768` |

```json
{
  "model": "gemini-3-pro-preview",
  "reasoning_effort": "high",
  "messages": [{"role": "user", "content": "Prove the Pythagorean theorem"}]
}
```

> **Note:** If both `thinking_budget` and `reasoning_effort` are specified, `reasoning_effort` takes precedence.

### Reasoning in Responses

**Streaming:** Reasoning content appears in `delta.reasoning_content`:

```json
{
  "choices": [{
    "delta": { "reasoning_content": "Let me think about this..." },
    "finish_reason": null
  }]
}
```

**Non-streaming:** Reasoning appears in `message.reasoning_content`:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "The answer is...",
      "reasoning_content": "Let me think about this..."
    }
  }]
}
```

---

## Tool / Function Calling

Tools are passed in OpenAI format and automatically translated to Gemini's native format:

```json
{
  "model": "gemini-2.5-flash",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get weather for a location",
      "parameters": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      }
    }
  }],
  "tool_choice": "auto"
}
```

Supported `tool_choice` values: `"auto"`, `"none"`, `"required"`.

---

## Overage Billing

When quota is exhausted, Google One AI credits may be available. The server's behavior depends on the `OVERAGE_STRATEGY`:

| Strategy | Behavior |
|---|---|
| `never` | Never use credits (default) |
| `always` | Automatically use credits if balance ≥ 50 |
| `ask` | Prompt the client to confirm |

Eligible models: `gemini-3-pro-preview`, `gemini-3.1-pro-preview`.
