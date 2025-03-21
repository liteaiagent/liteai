# Skills

Skills are **reusable instruction sets** — markdown files that teach the LLM how to
perform specific tasks. They are not tools (the LLM cannot "call" a skill directly);
instead, skills are **listed in the system prompt** to inform the LLM of their existence,
and the LLM uses the `skill` tool to load one on demand.

---

## How Skills Work

```
Startup                              Runtime
┌──────────────────────┐             ┌─────────────────────────────┐
│  Scan skill dirs     │             │  LLM sees skill list in     │
│  for SKILL.md files  │─────┐       │  system prompt (names only) │
│                      │     │       └─────────────┬───────────────┘
│  Parse frontmatter:  │     │                     │
│  - name              │     ▼                     │ LLM decides to load
│  - description       │  Skill.state()            │
└──────────────────────┘  (registry)               ▼
                             │       ┌─────────────────────────────┐
                             │       │  skill tool call            │
                             │       │  { name: "deploy" }         │
                             │       └─────────────┬───────────────┘
                             │                     │
                             ▼                     ▼
                       System prompt          Tool output:
                       includes:              <skill_content name="deploy">
                       <available_skills>       # Skill: deploy
                         <skill>                ...full instructions...
                           <name>deploy         <skill_files>
                           <description>...       file1.sh
                         </skill>                 file2.py
                       </available_skills>      </skill_files>
                                              </skill_content>
```

1. **At startup**, liteai scans directories for `SKILL.md` files and registers them.
2. **In the system prompt**, skill names and descriptions are listed so the LLM knows
   what's available.
3. **At runtime**, the LLM calls the `skill` tool with a skill name. The tool returns
   the full skill content (markdown body) plus a list of associated files in the skill's
   directory (scripts, templates, etc.).
4. Skills are **lazy-loaded** — their full content is only injected when the LLM
   requests it, keeping the system prompt compact.

---

## Creating a Skill

A skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```
my-skill/
├── SKILL.md           # Required — instructions + metadata
├── scripts/           # Optional — helper scripts
│   └── deploy.sh
├── templates/         # Optional — file templates
│   └── config.yaml
└── reference/         # Optional — reference docs
    └── api-spec.md
```

### SKILL.md Format

```markdown
---
name: deploy
description: Deploys the application to production using Docker and Kubernetes
---
## Steps

1. Build the Docker image using `scripts/deploy.sh`
2. Push to the container registry
3. Apply the Kubernetes manifests in `templates/`

## Important

- Always check the current branch before deploying
- Run tests first with `npm test`
```

| Frontmatter field | Required | Description |
|---|---|---|
| `name` | Yes | Unique skill identifier (used by the `skill` tool) |
| `description` | Yes | When to use this skill (shown in system prompt and tool description) |

The markdown body becomes the skill's instructions, injected into the tool output when
loaded.

### Associated Files

Any files alongside `SKILL.md` (up to 10, sampled) are listed in the `<skill_files>`
block when the skill is loaded. The LLM can then `read` these files if needed. Common
patterns:

- **`scripts/`** — shell scripts or automation helpers the LLM can execute
- **`templates/`** — file templates the LLM can copy and adapt
- **`reference/`** — documentation or specs the LLM can study
- **`examples/`** — reference implementations

---

## Skill Discovery

Skills are discovered from multiple locations, loaded in order (later sources overwrite
earlier ones with the same name):

### 1. External directories (compatible with Claude Code)

Unless `$LITEAI_DISABLE_EXTERNAL_SKILLS` is set, liteai scans:

- **Global**: `~/.claude/skills/**/SKILL.md` and `~/.agents/skills/**/SKILL.md`
- **Project-level**: `.claude/skills/**/SKILL.md` and `.agents/skills/**/SKILL.md`
  (walked from cwd to workspace root)

### 2. LiteAI config directories

- `.liteai/skill/**/SKILL.md` and `.liteai/skills/**/SKILL.md`
- Scanned from global config dir and project `.liteai/` directories

### 3. Config `skills.paths` (additional directories)

```jsonc
// liteai.json
{
  "skills": {
    "paths": [
      "./custom-skills",
      "~/shared-skills"
    ]
  }
}
```

Each path is scanned for `**/SKILL.md` files.

### 4. Config `skills.urls` (remote skills)

```jsonc
// liteai.json
{
  "skills": {
    "urls": [
      "https://example.com/.well-known/skills/"
    ]
  }
}
```

The URL must serve an `index.json` with the format:

```json
{
  "skills": [
    {
      "name": "deploy",
      "description": "...",
      "files": ["SKILL.md", "scripts/deploy.sh"]
    }
  ]
}
```

Files are downloaded and cached locally in `~/.liteai/cache/skills/`.

---

## Skills in the System Prompt

When skills are available, the system prompt includes a skills block (§3.3 in
[prompt-engineering.md](file:///docs/prompt-engineering.md)):

```xml
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <name>deploy</name>
    <description>Deploys the application to production</description>
    <location>file:///path/to/deploy/SKILL.md</location>
  </skill>
</available_skills>
```

The `skill` tool description also includes a condensed skill list.

---

## The Skill Tool

The `skill` tool (`src/tool/skill.ts`) is how the LLM loads a skill at runtime:

1. LLM calls `skill({ name: "deploy" })`
2. Permission check — `PermissionNext.ask({ permission: "skill", patterns: ["deploy"] })`
3. Skill content is read from `SKILL.md`
4. Up to 10 associated files are listed from the skill directory
5. Returns a `<skill_content>` block with the full instructions and file list

### Permission Control

Skill access is governed by the agent's `permission` field:

```yaml
# Deny all skills
permission:
  skill: deny

# Allow specific skills only
permission:
  skill:
    "deploy": allow
    "test": allow
    "*": deny
```

When `skill` permission is denied entirely, the skills block is also **removed from the
system prompt** — the LLM won't know skills exist at all.

---

## Source Reference

| Component | File | Responsibility |
|---|---|---|
| Skill registry | [`skill/skill.ts`](file:///src/skill/skill.ts) | Discovery, loading, formatting, permission filtering |
| Skill discovery | [`skill/discovery.ts`](file:///src/skill/discovery.ts) | Remote skill fetching from URLs |
| Skill tool | [`tool/skill.ts`](file:///src/tool/skill.ts) | On-demand skill loading via tool call |
| Config schema | [`config/config.ts`](file:///src/config/config.ts) | `skills.paths` and `skills.urls` config |
| System prompt | [`session/system.ts`](file:///src/session/system.ts) | Skills block generation |
