# Phase 7: Skill System Enhancements

> **Goal**: Adapt high-impact skills from superpowers/speckit for the new workflow. This is additive — no breaking changes.

---

## 7A. Existing Speckit Skills Audit

Current LiteAI skills (from `.agent/skills/`):

| Skill | Purpose | Plan Mode Impact |
|-------|---------|-----------------|
| `speckit-specify` | Create/update feature spec from description | Usable in plan subagent |
| `speckit-clarify` | Identify underspecified areas, ask questions | Root agent (before plan_enter) |
| `speckit-plan` | Execute planning workflow with templates | **Overlaps with plan subagent** — needs reconciliation |
| `speckit-tasks` | Generate tasks.md from design artifacts | Usable in plan or post-plan |
| `speckit-implement` | Execute tasks from tasks.md | Post-plan implementation |
| `speckit-analyze` | Cross-artifact consistency analysis | Post-plan QA |
| `speckit-checklist` | Generate custom checklist | Usable anywhere |
| `speckit-constitution` | Create/update project constitution | Pre-planning setup |
| `speckit-taskstoissues` | Convert tasks to GitHub issues | Post-plan action |
| `ui-ux-pro-max` | UI/UX design intelligence | Plan or implementation |

**Actions**:
- Audit each skill for compatibility with new plan workflow
- Reconcile `speckit-plan` with the new plan subagent (they serve similar roles — plan subagent may use speckit-plan internally)
- Update any skill that references old plan_enter/plan_exit behavior

---

## 7B. New Skills from Superpowers

### Priority 1

| Skill | Source | Rationale |
|-------|--------|-----------|
| `systematic-debugging` | superpowers | Agents default to random fixes. 4-phase root-cause + 3-fix escalation |
| `verification-before-completion` | superpowers | Agents claim "done" without evidence. Iron Law: no claims without fresh verification |

### Priority 2

| Skill | Source | Rationale |
|-------|--------|-----------|
| `explore-and-research` | New (inspired by superpowers brainstorming + speckit-plan Phase 0) | Formalizes exploration before planning |
| `subagent-execution` | superpowers:subagent-driven-development | Fresh subagent per task + two-stage review |
| `parallel-dispatch` | superpowers:dispatching-parallel-agents | One agent per independent problem domain |

### Skill Integration with Plan Workflow

- Skills can be invoked by the plan subagent (if relevant skills are in its allowed set)
- Skills can be invoked during implementation phase by the root agent
- Consider: should the plan agent have access to speckit skills?

---

## Deliverables

- Updated existing skills for compatibility
- 2 new high-impact skills adapted from superpowers (P1)
- 3 additional skills for advanced orchestration (P2)
