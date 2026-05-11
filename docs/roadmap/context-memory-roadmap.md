---
title: "Roadmap: Context & memory"
description: "Implementation status and future plans for LiteAI's context instructions and memory system."
---

# Context & memory roadmap

The context and memory subsystem has the most planned work remaining. Current state: **34/76 implemented** (45%).

## What's implemented ✅

### Context instructions (20/20 ✅)
- Global instruction file loading (`~/.liteai/AGENTS.md`)
- Project instruction file loading with `findUp` traversal
- Custom instruction paths from config
- Remote instruction URLs (HTTP fetch, 5s timeout)
- Subdirectory JIT loading
- Duplicate claim guard (per-message)
- System prompt injection
- `LITEAI_CONFIG_DIR` override
- `LITEAI_DISABLE_PROJECT_CONFIG` flag
- Full platform profile system (standard, claude, gemini, codex)

### Agent memory — current model (14/14 ✅)
- Per-agent memory directories (user/project/local scope)
- Auto-memory enable/disable (env + config)
- Memory prompt loading and snapshot management
- `readMemory`, `writeMemory`, `editMemory` tools
- Scope-aware directory resolution
- Path traversal guard

## What's planned ❌

### Context instructions v2 (0/3)
| Feature | Status |
|---|---|
| `.liteai/rules/*.md` modular rule files | ❌ Planned |
| JIT / subdirectory lazy loading on path access | ❌ Planned |
| `AGENTS.local.md` (private, not git-committed) | ❌ Planned |

### Unified memory system (0/6)
Replaces per-agent memory with project-scoped storage under `~/.liteai/projects/<id>/memory/`.

| Feature | Status |
|---|---|
| `MEMORY.md` index file | ❌ Planned |
| Topic files (user-profile, feedback, project-context, references) | ❌ Planned |
| Memory type taxonomy | ❌ Planned |
| Index cap (200 lines / 25KB) | ❌ Planned |
| System prompt injection (index only) | ❌ Planned |
| "What NOT to save" enforcement | ❌ Planned |

### Memory tools v2 (0/7)
| Feature | Status |
|---|---|
| `save_memory` tool (typed) | ❌ Planned |
| JIT topic file access | ❌ Planned |
| Root-agent-only access control | ❌ Planned |
| Subagent read-only inheritance | ❌ Planned |
| `/remember <fact>` command | ❌ Planned |
| Remove legacy `AgentMemory` namespace | ❌ Planned |
| Remove per-agent memory directories | ❌ Planned |

### Background memory extraction (0/4)
| Feature | Status |
|---|---|
| In-session forked extraction agent | ❌ Planned |
| Token + tool-call threshold triggers | ❌ Planned |
| Dedup (skip if agent already wrote memory) | ❌ Planned |
| Non-blocking background execution | ❌ Planned |

### Conversation history & recall (0/10)
| Feature | Status |
|---|---|
| Background summarization agent (session end) | ❌ Planned |
| Title + summary + tags generation | ❌ Planned |
| `index.jsonl` append-only storage | ❌ Planned |
| System prompt injection (conversation history) | ❌ Planned |
| Full recall from DB (`recall_conversation`) | ❌ Planned |

### Skills extraction (0/7)
| Feature | Status |
|---|---|
| Post-session background extraction agent | ❌ Planned |
| Repeating workflow detection | ❌ Planned |
| Skills inbox + accept/reject/edit commands | ❌ Planned |

### Session export (0/2)
| Feature | Status |
|---|---|
| `/export` command (Markdown) | ❌ Planned |
| `GET /session/:id/export` API | ❌ Planned |

### Content replacement (0/3)
| Feature | Status |
|---|---|
| Large tool result → summary replacement | ❌ Planned |
| On-demand full result expansion | ❌ Planned |
| Compaction hook integration | ❌ Planned |
