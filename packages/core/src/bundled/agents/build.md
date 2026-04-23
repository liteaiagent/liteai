---
name: build
mode: primary
description: "The default root agent (LiteAI). Full tool access, can invoke subagents and plan mode."
tools:
  - "*"
# ──────────────────────────────────────────────────────────────
# SYSTEM PROMPT: This agent's system prompt comes from system.md
# (bundled/prompts/system/system.md), injected by the session engine.
# Do NOT add instructions in the body — the body is intentionally empty.
# Subagents (explore.md, plan.md) define their own prompts in their body.
# ──────────────────────────────────────────────────────────────
---
