---
title: Error reference
description: "Common error types and their resolutions."
---

# Error reference

## Provider errors

| Error | Cause | Resolution |
|---|---|---|
| `ProviderAuthError` | Invalid or missing API key | Check `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` |
| `ProviderRateLimit` | Too many requests | Wait and retry, or use a different model |
| `ProviderContextOverflow` | Input exceeds model context | Enable auto-compaction or shorten AGENTS.md |
| `ProviderUnavailable` | Provider API is down | Check provider status page |

## Session errors

| Error | Cause | Resolution |
|---|---|---|
| `SessionNotFound` | Invalid session ID | List sessions with `GET /session` |
| `SessionAlreadyExists` | Duplicate session creation | Use existing session or generate new ID |
| `TurnBudgetExceeded` | Agent exceeded max turns | Increase `maxTurns` or break the task into steps |

## Tool errors

| Error | Cause | Resolution |
|---|---|---|
| `ToolNotFound` | Model called a non-existent tool | Check tool pool, ensure MCP servers are running |
| `ToolPermissionDenied` | User denied the tool action | Approve the action or use a different approach |
| `ToolExecutionFailed` | Tool threw an error | Check tool arguments and file/path existence |

## Agent errors

| Error | Cause | Resolution |
|---|---|---|
| `AgentSpawnError` | Failed to fork subagent | Check agent definition and available resources |
| `TeammateAborted` | Coordinator teammate was force-stopped | Check teammate logs for root cause |

## Configuration errors

| Error | Cause | Resolution |
|---|---|---|
| `ConfigValidationError` | Invalid settings.json | Fix schema errors in the config file |
| `PluginLoadError` | Plugin failed to initialize | Check plugin manifest and dependencies |
| `MCPServerError` | MCP server failed to start | Check server command and environment |
