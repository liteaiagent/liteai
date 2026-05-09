# LiteAI Core — Providers & Models

> **Scope:** `src/provider/`, `src/provider/loaders/`, `src/provider/sdk/`, `src/provider/transform/`  
> **Last audited:** 2026-05-09

---

## 1. Provider Framework

| Feature | Status | Source |
|---|:---:|---|
| Provider Model | ✅ | [`provider/provider.ts`](../../packages/core/src/provider/provider.ts) |
| Provider State Manager | ✅ | [`provider/state.ts`](../../packages/core/src/provider/state.ts) (25KB) |
| Provider Schema (ID types) | ✅ | [`provider/schema.ts`](../../packages/core/src/provider/schema.ts) |
| Provider Error Handling | ✅ | [`provider/error.ts`](../../packages/core/src/provider/error.ts) |
| Provider Auth | ✅ | [`provider/auth.ts`](../../packages/core/src/provider/auth.ts) |
| Provider Auth Service | ✅ | [`provider/auth-service.ts`](../../packages/core/src/provider/auth-service.ts) |
| Provider SSE Events | ✅ | [`provider/sse.ts`](../../packages/core/src/provider/sse.ts) |
| AI SDK Integration | ✅ | [`provider/sdk.ts`](../../packages/core/src/provider/sdk.ts) |
| Model Registry | ✅ | [`provider/models.ts`](../../packages/core/src/provider/models.ts) |
| Models Snapshot (static data) | ✅ | [`provider/models-snapshot.ts`](../../packages/core/src/provider/models-snapshot.ts) (1.8MB) |
| Default Model Selection | ✅ | [`provider/provider.ts`](../../packages/core/src/provider/provider.ts) `defaultModel()` |

---

## 2. Provider Loaders

📁 **Scanned:** `src/provider/loaders/` — 20 loader files + index + types

| Provider | Status | Source |
|---|:---:|---|
| Anthropic | ✅ | [`loaders/anthropic.ts`](../../packages/core/src/provider/loaders/anthropic.ts) |
| OpenAI | ✅ | [`loaders/openai.ts`](../../packages/core/src/provider/loaders/openai.ts) |
| OpenAI-Compatible (generic) | ✅ | [`loaders/openai-compat-fetch.ts`](../../packages/core/src/provider/loaders/openai-compat-fetch.ts) |
| OpenRouter | ✅ | [`loaders/openrouter.ts`](../../packages/core/src/provider/loaders/openrouter.ts) |
| Google Vertex | ✅ | [`loaders/google-vertex.ts`](../../packages/core/src/provider/loaders/google-vertex.ts) |
| Google Code Assist | ✅ | [`loaders/google-code-assist.ts`](../../packages/core/src/provider/loaders/google-code-assist.ts) |
| GitHub Copilot | ✅ | [`loaders/github-copilot.ts`](../../packages/core/src/provider/loaders/github-copilot.ts) |
| GitLab | ✅ | [`loaders/gitlab.ts`](../../packages/core/src/provider/loaders/gitlab.ts) |
| Amazon Bedrock | ✅ | [`loaders/amazon-bedrock.ts`](../../packages/core/src/provider/loaders/amazon-bedrock.ts) |
| Azure | ✅ | [`loaders/azure.ts`](../../packages/core/src/provider/loaders/azure.ts) |
| Cerebras | ✅ | [`loaders/cerebras.ts`](../../packages/core/src/provider/loaders/cerebras.ts) |
| Cloudflare | ✅ | [`loaders/cloudflare.ts`](../../packages/core/src/provider/loaders/cloudflare.ts) |
| LM Studio | ✅ | [`loaders/lmstudio.ts`](../../packages/core/src/provider/loaders/lmstudio.ts) |
| Vercel | ✅ | [`loaders/vercel.ts`](../../packages/core/src/provider/loaders/vercel.ts) |
| SAP AI Core | ✅ | [`loaders/sap-ai-core.ts`](../../packages/core/src/provider/loaders/sap-ai-core.ts) |
| Kilo | ✅ | [`loaders/kilo.ts`](../../packages/core/src/provider/loaders/kilo.ts) |
| OpenCode | ✅ | [`loaders/opencode.ts`](../../packages/core/src/provider/loaders/opencode.ts) |
| ZenMux | ✅ | [`loaders/zenmux.ts`](../../packages/core/src/provider/loaders/zenmux.ts) |
| AI4All | ✅ | [`loaders/ai4all.ts`](../../packages/core/src/provider/loaders/ai4all.ts) |
| Bundled (embedded) | ✅ | [`loaders/bundled.ts`](../../packages/core/src/provider/loaders/bundled.ts) |
| Loader Index | ✅ | [`loaders/index.ts`](../../packages/core/src/provider/loaders/index.ts) |

---

## 3. Provider SDKs (Custom Clients)

📁 **Scanned:** `src/provider/sdk/`

| SDK | Status | Source |
|---|:---:|---|
| Google Code Assist SDK | ✅ | [`sdk/code-assist/`](../../packages/core/src/provider/sdk/code-assist/) |
| GitHub Copilot SDK | ✅ | [`sdk/copilot/`](../../packages/core/src/provider/sdk/copilot/) |

---

## 4. Message & Option Transforms

📁 **Scanned:** `src/provider/transform/`

| Feature | Status | Source |
|---|:---:|---|
| Message Transform | ✅ | [`transform/message.ts`](../../packages/core/src/provider/transform/message.ts) |
| Options Transform | ✅ | [`transform/options.ts`](../../packages/core/src/provider/transform/options.ts) |
| Provider Variants | ✅ | [`transform/variants.ts`](../../packages/core/src/provider/transform/variants.ts) |
| Transform Index | ✅ | [`transform/index.ts`](../../packages/core/src/provider/transform/index.ts) |

---

## Summary

| Category | ✅ | 🔶 | ❌ | Total |
|---|:---:|:---:|:---:|:---:|
| Provider Framework | 11 | 0 | 0 | 11 |
| Provider Loaders | 21 | 0 | 0 | 21 |
| Provider SDKs | 2 | 0 | 0 | 2 |
| Transforms | 4 | 0 | 0 | 4 |
| **Total** | **38** | **0** | **0** | **38** |
