# Skill System Proposal

## Analysis: Superpowers vs Speckit vs What We Need

### What Superpowers Does Well

| Skill | Key Insight | Applicable? |
|-------|-------------|-------------|
| brainstorming | Hard gate on coding until design approved; one question at a time; visual companion | Yes — the "clarify before plan" pattern |
| writing-plans | Bite-sized TDD tasks; no placeholders; self-review; exact file paths | Yes — plan quality standards |
| subagent-driven-development | Fresh subagent per task + two-stage review (spec then quality) | Yes — execution quality |
| dispatching-parallel-agents | One agent per independent problem domain | Yes — parallel debug/build |
| systematic-debugging | 4-phase root cause before fix; 3-fix architectural escalation | Yes — critical missing skill |
| verification-before-completion | Evidence before claims; iron law | Yes — critical missing skill |
| writing-skills | TDD for documentation; pressure testing | Nice-to-have |

### What Speckit Does Well

| Skill | Key Insight |
|-------|-------------|
| speckit-specify | Structured spec from natural language with quality validation |
| speckit-clarify | Taxonomy-based ambiguity detection, max 5 questions, incremental spec updates |
| speckit-plan | Research phase → data model → contracts → agent context |
| speckit-tasks | User-story-organized task breakdown with dependency graphs |
| speckit-analyze | Cross-artifact consistency analysis (read-only) |
| speckit-implement | Phase-by-phase execution with TDD and progress tracking |

### Gap Analysis

| Capability | Superpowers | Speckit | LiteAI Core | Status |
|-----------|-------------|---------|-------------|--------|
| Brainstorm/clarify | ✅ brainstorming | ✅ speckit-clarify | ❌ | **Covered by skills, need system prompt** |
| Explore/research | ❌ | Partial (speckit-plan Phase 0) | ✅ explorer agent | **Need skill to formalize** |
| Plan writing | ✅ writing-plans | ✅ speckit-plan | ✅ plan subagent | **Covered** |
| Task breakdown | ❌ | ✅ speckit-tasks | ❌ | **Covered by skill** |
| Execution | ✅ executing-plans + subagent-driven | ✅ speckit-implement | ✅ task tool | **Covered** |
| Parallel dispatch | ✅ dispatching-parallel-agents | ❌ | ❌ | **GAP — need new skill** |
| Debugging | ✅ systematic-debugging | ❌ | ❌ | **GAP — need new skill** |
| Verification | ✅ verification-before-completion | ❌ | ❌ | **GAP — need new skill** |
| Code review | ✅ requesting-code-review | ❌ | ❌ | **GAP — consider** |
| Spec analysis | ❌ | ✅ speckit-analyze | ❌ | **Covered by skill** |

## Proposed New Skills

### Priority 1: Adapt from Superpowers (Critical Gaps)

#### 1. `systematic-debugging`

**Why**: Agents default to "try random fixes" behavior. This is the single highest-impact skill for code quality.

**Adapted from**: superpowers:systematic-debugging

**Key adaptations for LiteAI**:
- Replace TodoWrite references with LiteAI's todo system
- Replace Bash-first examples with cross-platform patterns
- Add integration with explorer agent for evidence gathering
- Keep the 4-phase process, 3-fix escalation rule, rationalization table
- Keep the "Iron Law: NO FIXES WITHOUT ROOT CAUSE"

**Trigger**: Use when encountering any bug, test failure, or unexpected behavior

---

#### 2. `verification-before-completion`

**Why**: Agents claim "done" without running tests. This is the second highest-impact skill.

**Adapted from**: superpowers:verification-before-completion

**Key adaptations for LiteAI**:
- Reference LiteAI's `bun typecheck`, `bun lint:fix`, `bun test` commands
- Add TUI-specific verification (runtime check)
- Keep the "Iron Law: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE"
- Keep rationalization table and red flags

**Trigger**: Use when about to claim work is complete or passing

---

#### 3. `parallel-dispatch`

**Why**: When debugging 3+ independent failures or building independent components, sequential execution wastes time.

**Adapted from**: superpowers:dispatching-parallel-agents

**Key adaptations for LiteAI**:
- Use LiteAI's `task` tool for dispatch
- Reference LiteAI's subagent types (explorer, general, plan)
- Add verification step using task_id resume
- Keep decision flowchart, prompt structure guidelines, common mistakes

**Trigger**: Use when facing 2+ independent tasks that can be worked on without shared state

---

### Priority 2: New Skills (Workflow Gaps)

#### 4. `explore-and-research`

**Why**: Formalizes the "exploration before planning" phase that the new workflow requires.

**No direct superpowers equivalent** — this is new, inspired by:
- brainstorming's "Explore project context" step
- speckit-plan's "Phase 0: Research"
- The explorer agent's existing capabilities

**Core pattern**:
1. Launch explorer agent to scan codebase structure, patterns, conventions
2. If external APIs/libs needed → web search for latest docs, best practices
3. Consolidate findings into structured research output
4. Return: tech stack recommendations, existing patterns, integration points, risks

**Trigger**: Use before planning when the task involves unfamiliar code, external dependencies, or architectural decisions

---

#### 5. `subagent-execution`

**Why**: Formalizes how to execute plans via subagents with quality gates.

**Adapted from**: superpowers:subagent-driven-development

**Key adaptations for LiteAI**:
- Use LiteAI's `task` tool with `keepHistory: true`
- Remove git worktree requirement (not applicable)
- Keep: fresh subagent per task, spec compliance review, code quality review
- Keep: DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED status handling
- Add: typecheck + lint verification between tasks

**Trigger**: Use when executing an approved implementation plan with independent tasks

---

### Priority 3: Consider Later

#### 6. `code-review` (Deferred)

Formal review skill with diff-based analysis. Lower priority since verification-before-completion covers the critical path. Can be added when multi-agent review loops are stable.

#### 7. `writing-skills` (Deferred)

TDD for skill documentation. Useful once the skill system is mature. Not urgent for the workflow redesign.

## Integration with New Workflow

```
User: Complex prompt
  │
  ▼
System Prompt Section 5: Complexity Assessment
  │ "Is this complex enough to need the workflow?"
  │
  ├─ Simple → Execute directly
  │
  ├─ Complex → Enter workflow:
  │    │
  │    ▼
  │    [OPTIONAL] Ask clarifying questions (speckit-clarify pattern)
  │    │
  │    ▼
  │    [OPTIONAL] explore-and-research skill → explorer agent
  │    │
  │    ▼
  │    plan_enter (subagent) → plan written → user approves
  │    │
  │    ▼
  │    [OPTIONAL] speckit-tasks skill → task breakdown
  │    │
  │    ▼
  │    subagent-execution skill → task-per-subagent with review
  │    │
  │    ▼
  │    verification-before-completion skill → final check
  │
  ▼
Done
```

## Implementation Order

1. **Phase 1**: Core workflow redesign (01-agent-workflow-redesign.md) — no new skills needed
2. **Phase 2**: systematic-debugging + verification-before-completion — highest-impact standalone skills
3. **Phase 3**: explore-and-research + subagent-execution — workflow-dependent skills
4. **Phase 4**: parallel-dispatch — optimization skill
