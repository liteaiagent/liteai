import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { type AccessToken, Account, type AccountID, type OrgID } from "../../src/account"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// Get managed config directory from environment (set in preload.ts)
const managedConfigDir = process.env.LITEAI_TEST_MANAGED_CONFIG_DIR ?? ""

afterEach(async () => {
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
})

async function writeManagedSettings(settings: object, filename = "settings.json") {
  await fs.mkdir(managedConfigDir, { recursive: true })
  await Filesystem.write(path.join(managedConfigDir, filename), JSON.stringify(settings))
}

async function writeConfig(dir: string, config: object, name = "settings.json") {
  await Filesystem.write(path.join(dir, name), JSON.stringify(config))
}

async function check(map: (dir: string) => string) {
  if (process.platform !== "win32") return
  await using globalTmp = await tmpdir()
  await using tmp = await tmpdir({ git: true, config: { snapshot: true } })
  const prev = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  Config.global.reset()
  try {
    await writeConfig(globalTmp.path, {
      $schema: "https://liteai.com/config.json",
      snapshot: false,
    })
    await Instance.provide({
      directory: map(tmp.path),
      fn: async () => {
        const cfg = await Config.get()
        expect(cfg.snapshot).toBe(true)
        expect(Instance.directory).toBe(Filesystem.resolve(tmp.path))
        expect(Instance.project.id).toBeTruthy()
      },
    })
  } finally {
    await Instance.disposeAll()
    ;(Global.Path as { config: string }).config = prev
    Config.global.reset()
  }
}

test("loads config with defaults when no files exist", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBeDefined()
    },
  })
})

test("loads JSON config file", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        model: "test/model",
        username: "testuser",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("test/model")
      expect(config.username).toBe("testuser")
    },
  })
})

test("loads project config from Git Bash and MSYS2 paths on Windows", async () => {
  // Git Bash and MSYS2 both use /<drive>/... paths on Windows.
  await check((dir) => {
    const drive = dir[0]?.toLowerCase()
    const rest = dir.slice(2).replaceAll("\\", "/")
    return `/${drive}${rest}`
  })
})

test("loads project config from Cygwin paths on Windows", async () => {
  await check((dir) => {
    const drive = dir[0]?.toLowerCase()
    const rest = dir.slice(2).replaceAll("\\", "/")
    return `/cygdrive/${drive}${rest}`
  })
})

test("ignores legacy tui keys in liteai config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        model: "test/model",
        theme: "legacy",
        tui: { scroll_speed: 4 },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("test/model")
      expect((config as Record<string, unknown>).theme).toBeUndefined()
      expect((config as Record<string, unknown>).tui).toBeUndefined()
    },
  })
})

test("merges multiple config files with correct precedence", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(
        dir,
        {
          $schema: "https://liteai.com/config.json",
          model: "base",
          username: "base",
        },
        "settings.json",
      )
      await writeConfig(
        path.join(dir, ".liteai"),
        {
          $schema: "https://liteai.com/config.json",
          model: "override",
        },
        "settings.json",
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("override")
      expect(config.username).toBe("base")
    },
  })
})

test("handles environment variable substitution", async () => {
  const originalEnv = process.env.TEST_VAR
  process.env.TEST_VAR = "test-user"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeConfig(dir, {
          $schema: "https://liteai.com/config.json",
          username: "{env:TEST_VAR}",
        })
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.username).toBe("test-user")
      },
    })
  } finally {
    if (originalEnv !== undefined) {
      process.env.TEST_VAR = originalEnv
    } else {
      delete process.env.TEST_VAR
    }
  }
})

test("preserves env variables when adding $schema to config", async () => {
  const originalEnv = process.env.PRESERVE_VAR
  process.env.PRESERVE_VAR = "secret_value"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Config without $schema - should trigger auto-add
        await Filesystem.write(
          path.join(dir, "settings.json"),
          JSON.stringify({
            username: "{env:PRESERVE_VAR}",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.username).toBe("secret_value")

        // Read the file to verify the env variable was preserved
        const content = await Filesystem.readText(path.join(tmp.path, "settings.json"))
        expect(content).toContain("{env:PRESERVE_VAR}")
        expect(content).not.toContain("secret_value")
        expect(content).toContain("$schema")
      },
    })
  } finally {
    if (originalEnv !== undefined) {
      process.env.PRESERVE_VAR = originalEnv
    } else {
      delete process.env.PRESERVE_VAR
    }
  }
})

test("resolves env templates in account config with account token", async () => {
  const originalActive = Account.active
  const originalConfig = Account.config
  const originalToken = Account.token
  const originalControlToken = process.env.LITEAI_CONSOLE_TOKEN

  Account.active = mock(() => ({
    id: "account-1" as AccountID,
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: "org-1" as OrgID,
  }))

  Account.config = mock(async () => ({
    provider: {
      opencode: {
        options: {
          apiKey: "{env:LITEAI_CONSOLE_TOKEN}",
        },
      },
    },
  }))

  Account.token = mock(async () => "st_test_token" as AccessToken)

  try {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.provider?.opencode?.options?.apiKey).toBe("st_test_token")
      },
    })
  } finally {
    Account.active = originalActive
    Account.config = originalConfig
    Account.token = originalToken
    if (originalControlToken !== undefined) {
      process.env.LITEAI_CONSOLE_TOKEN = originalControlToken
    } else {
      delete process.env.LITEAI_CONSOLE_TOKEN
    }
  }
})

test("handles file inclusion substitution", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "included.txt"), "test-user")
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        username: "{file:included.txt}",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBe("test-user")
    },
  })
})

test("handles file inclusion with replacement tokens", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "included.md"), "const out = await Bun.$`echo hi`")
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        username: "{file:included.md}",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBe("const out = await Bun.$`echo hi`")
    },
  })
})

test("validates config schema and throws on invalid fields", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        invalid_field: "should cause error",
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Strict schema should throw an error for invalid fields
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("throws error for invalid JSON", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(path.join(dir, "settings.json"), "{ invalid json }")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})

test("handles agent configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        agent: {
          test_agent: {
            model: "test/model",
            temperature: 0.7,
            description: "test agent",
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.agent?.test_agent).toEqual(
        expect.objectContaining({
          model: "test/model",
          temperature: 0.7,
          description: "test agent",
        }),
      )
    },
  })
})

test("treats agent variant as model-scoped setting (not provider option)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        agent: {
          test_agent: {
            model: "openai/gpt-5.2",
            variant: "xhigh",
            max_tokens: 123,
          },
        },
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      const agent = config.agent?.test_agent

      expect(agent?.variant).toBe("xhigh")
      expect(agent?.options).toMatchObject({
        max_tokens: 123,
      })
      expect(agent?.options).not.toHaveProperty("variant")
    },
  })
})

test("handles command configuration", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        command: {
          test_command: {
            template: "test template",
            description: "test command",
            agent: "test_agent",
          },
        },
      })
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.command?.test_command).toEqual({
        template: "test template",
        description: "test command",
        agent: "test_agent",
      })
    },
  })
})

test("loads config from .liteai directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })
      const agentDir = path.join(liteaiDir, "agents")
      await fs.mkdir(agentDir, { recursive: true })

      await Filesystem.write(
        path.join(agentDir, "test.md"),
        `---
model: test/model
---
Test agent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.get("test")
      expect(agent).toMatchObject({
        name: "test",
        model: { providerID: "test", modelID: "model" },
        prompt: "Test agent prompt",
      })
    },
  })
})

test("loads agents from .liteai/agents (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })

      const agentsDir = path.join(liteaiDir, "agents")
      await fs.mkdir(path.join(agentsDir, "nested"), { recursive: true })

      await Filesystem.write(
        path.join(agentsDir, "helper.md"),
        `---
model: test/model
mode: subagent
---
Helper agent prompt`,
      )

      await Filesystem.write(
        path.join(agentsDir, "nested", "child.md"),
        `---
model: test/model
mode: subagent
---
Nested agent prompt`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Agent.get("helper")).toMatchObject({
        name: "helper",
        model: { providerID: "test", modelID: "model" },
        mode: "subagent",
        prompt: "Helper agent prompt",
      })

      expect(await Agent.get("nested/child")).toMatchObject({
        name: "nested/child",
        model: { providerID: "test", modelID: "model" },
        mode: "subagent",
        prompt: "Nested agent prompt",
      })
    },
  })
})

test("loads commands from .liteai/command (singular)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })

      const commandDir = path.join(liteaiDir, "command")
      await fs.mkdir(path.join(commandDir, "nested"), { recursive: true })

      await Filesystem.write(
        path.join(commandDir, "hello.md"),
        `---
description: Test command
---
Hello from singular command`,
      )

      await Filesystem.write(
        path.join(commandDir, "nested", "child.md"),
        `---
description: Nested command
---
Nested command template`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Command.get("hello")).toMatchObject({
        description: "Test command",
        template: "Hello from singular command",
      })

      expect(await Command.get("nested/child")).toMatchObject({
        description: "Nested command",
        template: "Nested command template",
      })
    },
  })
})

test("loads commands from .liteai/commands (plural)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })

      const commandsDir = path.join(liteaiDir, "commands")
      await fs.mkdir(path.join(commandsDir, "nested"), { recursive: true })

      await Filesystem.write(
        path.join(commandsDir, "hello.md"),
        `---
description: Test command
---
Hello from plural commands`,
      )

      await Filesystem.write(
        path.join(commandsDir, "nested", "child.md"),
        `---
description: Nested command
---
Nested command template`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Command.get("hello")).toMatchObject({
        description: "Test command",
        template: "Hello from plural commands",
      })

      expect(await Command.get("nested/child")).toMatchObject({
        description: "Nested command",
        template: "Nested command template",
      })
    },
  })
})

test("updates config and writes to file", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const newConfig = { model: "updated/model" }
      await Config.update(newConfig as Partial<Config.Info>)

      const writtenConfig = await Filesystem.readJson<Record<string, unknown>>(path.join(tmp.path, ".liteai", "settings.json"))
      expect(writtenConfig.model).toBe("updated/model")
    },
  })
})

test("gets config directories", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const dirs = await Config.directories()
      expect(dirs.length).toBeGreaterThanOrEqual(1)
    },
  })
})

test("does not error when only custom agent is a subagent", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })
      const agentDir = path.join(liteaiDir, "agents")
      await fs.mkdir(agentDir, { recursive: true })

      await Filesystem.write(
        path.join(agentDir, "helper.md"),
        `---
model: test/model
mode: subagent
---
Helper subagent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(await Agent.get("helper")).toMatchObject({
        name: "helper",
        model: { providerID: "test", modelID: "model" },
        mode: "subagent",
        prompt: "Helper subagent prompt",
      })
    },
  })
})

test("merges instructions arrays from global and local configs", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const liteaiDir = path.join(projectDir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })

      await Filesystem.write(
        path.join(dir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          instructions: ["global-instructions.md", "shared-rules.md"],
        }),
      )

      await Filesystem.write(
        path.join(liteaiDir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          instructions: ["local-instructions.md"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: path.join(tmp.path, "project"),
    fn: async () => {
      const config = await Config.get()
      const instructions = config.instructions ?? []

      expect(instructions).toContain("global-instructions.md")
      expect(instructions).toContain("shared-rules.md")
      expect(instructions).toContain("local-instructions.md")
      expect(instructions.length).toBe(3)
    },
  })
})

test("deduplicates duplicate instructions from global and local configs", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const projectDir = path.join(dir, "project")
      const liteaiDir = path.join(projectDir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })

      await Filesystem.write(
        path.join(dir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          instructions: ["duplicate.md", "global-only.md"],
        }),
      )

      await Filesystem.write(
        path.join(liteaiDir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          instructions: ["duplicate.md", "local-only.md"],
        }),
      )
    },
  })

  await Instance.provide({
    directory: path.join(tmp.path, "project"),
    fn: async () => {
      const config = await Config.get()
      const instructions = config.instructions ?? []

      expect(instructions).toContain("global-only.md")
      expect(instructions).toContain("local-only.md")
      expect(instructions).toContain("duplicate.md")

      const duplicates = instructions.filter((i) => i === "duplicate.md")
      expect(duplicates.length).toBe(1)
      expect(instructions.length).toBe(3)
    },
  })
}, 30000)

// Managed settings tests
// Note: preload.ts sets LITEAI_TEST_MANAGED_CONFIG which Global.Path.managedConfig uses

test("managed settings override user settings", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        model: "user/model",
        share: "auto",
        username: "testuser",
      })
    },
  })

  await writeManagedSettings({
    $schema: "https://liteai.com/config.json",
    model: "managed/model",
    share: "disabled",
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("managed/model")
      expect(config.share).toBe("disabled")
      expect(config.username).toBe("testuser")
    },
  })
})

test("managed settings override project settings", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        autoupdate: true,
        disabled_providers: [],
      })
    },
  })

  await writeManagedSettings({
    $schema: "https://liteai.com/config.json",
    autoupdate: false,
    disabled_providers: ["openai"],
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.autoupdate).toBe(false)
      expect(config.disabled_providers).toEqual(["openai"])
    },
  })
})

test("missing managed settings file is not an error", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        $schema: "https://liteai.com/config.json",
        model: "user/model",
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.model).toBe("user/model")
    },
  })
})

test("permission config preserves key order", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          permission: {
            "*": "deny",
            edit: "ask",
            write: "ask",
            external_directory: "ask",
            read: "allow",
            todowrite: "allow",
            todoread: "allow",
            "thoughts_*": "allow",
            "reasoning_model_*": "allow",
            "tools_*": "allow",
            "pr_comments_*": "allow",
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(Object.keys(config.permission ?? {})).toEqual([
        "*",
        "edit",
        "write",
        "external_directory",
        "read",
        "todowrite",
        "todoread",
        "thoughts_*",
        "reasoning_model_*",
        "tools_*",
        "pr_comments_*",
      ])
    },
  })
})

test("project config can override MCP server enabled status", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Base config with disabled MCP servers
      await Filesystem.write(
        path.join(dir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          mcpServers: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              enabled: false,
            },
            wiki: {
              type: "remote",
              url: "https://wiki.example.com/mcp",
              enabled: false,
            },
          },
        }),
      )
      // .liteai/settings.json enables just jira (higher precedence)
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })
      await Filesystem.write(
        path.join(liteaiDir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          mcpServers: {
            jira: {
              type: "remote",
              url: "https://jira.example.com/mcp",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      // jira should be enabled (overridden by .liteai config)
      expect(config.mcpServers?.jira).toEqual({
        type: "remote",
        url: "https://jira.example.com/mcp",
        enabled: true,
      })
      // wiki should still be disabled (not overridden)
      expect(config.mcpServers?.wiki).toEqual({
        type: "remote",
        url: "https://wiki.example.com/mcp",
        enabled: false,
      })
    },
  })
})

test("MCP config deep merges preserving base config properties", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Base config with full MCP definition
      await Filesystem.write(
        path.join(dir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          mcpServers: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              enabled: false,
              headers: {
                "X-Custom-Header": "value",
              },
            },
          },
        }),
      )
      // .liteai/settings.json override just enables it, should preserve other properties
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })
      await Filesystem.write(
        path.join(liteaiDir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          mcpServers: {
            myserver: {
              type: "remote",
              url: "https://myserver.example.com/mcp",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcpServers?.myserver).toEqual({
        type: "remote",
        url: "https://myserver.example.com/mcp",
        enabled: true,
        headers: {
          "X-Custom-Header": "value",
        },
      })
    },
  })
})

test("local .liteai config can override MCP from project config", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Project config with disabled MCP
      await Filesystem.write(
        path.join(dir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          mcpServers: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              enabled: false,
            },
          },
        }),
      )
      // Local .liteai directory config enables it
      const liteaiDir = path.join(dir, ".liteai")
      await fs.mkdir(liteaiDir, { recursive: true })
      await Filesystem.write(
        path.join(liteaiDir, "settings.json"),
        JSON.stringify({
          $schema: "https://liteai.com/config.json",
          mcpServers: {
            docs: {
              type: "remote",
              url: "https://docs.example.com/mcp",
              enabled: true,
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.mcpServers?.docs?.enabled).toBe(true)
    },
  })
})

test("project config overrides remote well-known config", async () => {
  const originalFetch = globalThis.fetch
  let fetchedUrl: string | undefined
  const mockFetch = mock((url: string | URL | Request) => {
    const urlStr = url.toString()
    if (urlStr.includes(".well-known/liteai")) {
      fetchedUrl = urlStr
      return Promise.resolve(
        new Response(
          JSON.stringify({
            config: {
              mcpServers: {
                jira: {
                  type: "remote",
                  url: "https://jira.example.com/mcp",
                  enabled: false,
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(url)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const originalAuthAll = Auth.all
  Auth.all = mock(() =>
    Promise.resolve({
      "https://example.com": {
        type: "wellknown" as const,
        key: "TEST_TOKEN",
        token: "test-token",
      },
    }),
  )

  try {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Project config enables jira (overriding remote default)
        await Filesystem.write(
          path.join(dir, "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
            mcpServers: {
              jira: {
                type: "remote",
                url: "https://jira.example.com/mcp",
                enabled: true,
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        // Verify fetch was called for wellknown config
        expect(fetchedUrl).toBe("https://example.com/.well-known/liteai")
        // Project config (enabled: true) should override remote (enabled: false)
        expect(config.mcpServers?.jira?.enabled).toBe(true)
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    Auth.all = originalAuthAll
  }
})

test("wellknown URL with trailing slash is normalized", async () => {
  const originalFetch = globalThis.fetch
  let fetchedUrl: string | undefined
  const mockFetch = mock((url: string | URL | Request) => {
    const urlStr = url.toString()
    if (urlStr.includes(".well-known/liteai")) {
      fetchedUrl = urlStr
      return Promise.resolve(
        new Response(
          JSON.stringify({
            config: {
              mcpServers: {
                slack: {
                  type: "remote",
                  url: "https://slack.example.com/mcp",
                  enabled: true,
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(url)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const originalAuthAll = Auth.all
  Auth.all = mock(() =>
    Promise.resolve({
      "https://example.com/": {
        type: "wellknown" as const,
        key: "TEST_TOKEN",
        token: "test-token",
      },
    }),
  )

  try {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Filesystem.write(
          path.join(dir, "settings.json"),
          JSON.stringify({
            $schema: "https://liteai.com/config.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.get()
        // Trailing slash should be stripped — no double slash in the fetch URL
        expect(fetchedUrl).toBe("https://example.com/.well-known/liteai")
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    Auth.all = originalAuthAll
  }
})

describe("LITEAI_DISABLE_PROJECT_CONFIG", () => {
  test("skips project config files when flag is set", async () => {
    const originalEnv = process.env.LITEAI_DISABLE_PROJECT_CONFIG
    process.env.LITEAI_DISABLE_PROJECT_CONFIG = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a project config that would normally be loaded
          await Filesystem.write(
            path.join(dir, "settings.json"),
            JSON.stringify({
              $schema: "https://liteai.com/config.json",
              model: "project/model",
              username: "project-user",
            }),
          )
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          // Project config should NOT be loaded - model should be default, not "project/model"
          expect(config.model).not.toBe("project/model")
          expect(config.username).not.toBe("project-user")
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LITEAI_DISABLE_PROJECT_CONFIG
      } else {
        process.env.LITEAI_DISABLE_PROJECT_CONFIG = originalEnv
      }
    }
  })

  test("skips project .liteai/ directories when flag is set", async () => {
    const originalEnv = process.env.LITEAI_DISABLE_PROJECT_CONFIG
    process.env.LITEAI_DISABLE_PROJECT_CONFIG = "true"

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a .liteai directory with a command
          const liteaiDir = path.join(dir, ".liteai", "command")
          await fs.mkdir(liteaiDir, { recursive: true })
          await Filesystem.write(path.join(liteaiDir, "test-cmd.md"), "# Test Command\nThis is a test command.")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const directories = await Config.directories()
          // Project .liteai should NOT be in directories list
          const hasProjectLiteai = directories.some((d) => d.startsWith(tmp.path))
          expect(hasProjectLiteai).toBe(false)
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LITEAI_DISABLE_PROJECT_CONFIG
      } else {
        process.env.LITEAI_DISABLE_PROJECT_CONFIG = originalEnv
      }
    }
  })

  test("still loads global config when flag is set", async () => {
    const originalEnv = process.env.LITEAI_DISABLE_PROJECT_CONFIG
    process.env.LITEAI_DISABLE_PROJECT_CONFIG = "true"

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Should still get default config (from global or defaults)
          const config = await Config.get()
          expect(config).toBeDefined()
          expect(config.username).toBeDefined()
        },
      })
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LITEAI_DISABLE_PROJECT_CONFIG
      } else {
        process.env.LITEAI_DISABLE_PROJECT_CONFIG = originalEnv
      }
    }
  })

  test("skips relative instructions with warning when flag is set but no config dir", async () => {
    const originalDisable = process.env.LITEAI_DISABLE_PROJECT_CONFIG
    const originalConfigDir = process.env.LITEAI_CONFIG_DIR

    try {
      // Ensure no config dir is set
      delete process.env.LITEAI_CONFIG_DIR
      process.env.LITEAI_DISABLE_PROJECT_CONFIG = "true"

      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a config with relative instruction path
          await Filesystem.write(
            path.join(dir, "settings.json"),
            JSON.stringify({
              $schema: "https://liteai.com/config.json",
              instructions: ["./CUSTOM.md"],
            }),
          )
          // Create the instruction file (should be skipped)
          await Filesystem.write(path.join(dir, "CUSTOM.md"), "# Custom Instructions")
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // The relative instruction should be skipped without error
          // We're mainly verifying this doesn't throw and the config loads
          const config = await Config.get()
          expect(config).toBeDefined()
          // The instruction should have been skipped (warning logged)
          // We can't easily test the warning was logged, but we verify
          // the relative path didn't cause an error
        },
      })
    } finally {
      if (originalDisable === undefined) {
        delete process.env.LITEAI_DISABLE_PROJECT_CONFIG
      } else {
        process.env.LITEAI_DISABLE_PROJECT_CONFIG = originalDisable
      }
      if (originalConfigDir === undefined) {
        delete process.env.LITEAI_CONFIG_DIR
      } else {
        process.env.LITEAI_CONFIG_DIR = originalConfigDir
      }
    }
  })

  test("LITEAI_CONFIG_DIR still works when flag is set", async () => {
    const originalDisable = process.env.LITEAI_DISABLE_PROJECT_CONFIG
    const originalConfigDir = process.env.LITEAI_CONFIG_DIR

    try {
      await using configDirTmp = await tmpdir({
        init: async (dir) => {
          // Create config in the custom config dir
          await Filesystem.write(
            path.join(dir, "settings.json"),
            JSON.stringify({
              $schema: "https://liteai.com/config.json",
              model: "configdir/model",
            }),
          )
        },
      })

      await using projectTmp = await tmpdir({
        init: async (dir) => {
          // Create config in project (should be ignored)
          await Filesystem.write(
            path.join(dir, "settings.json"),
            JSON.stringify({
              $schema: "https://liteai.com/config.json",
              model: "project/model",
            }),
          )
        },
      })

      process.env.LITEAI_DISABLE_PROJECT_CONFIG = "true"
      process.env.LITEAI_CONFIG_DIR = configDirTmp.path

      await Instance.provide({
        directory: projectTmp.path,
        fn: async () => {
          const config = await Config.get()
          // Should load from LITEAI_CONFIG_DIR, not project
          expect(config.model).toBe("configdir/model")
        },
      })
    } finally {
      if (originalDisable === undefined) {
        delete process.env.LITEAI_DISABLE_PROJECT_CONFIG
      } else {
        process.env.LITEAI_DISABLE_PROJECT_CONFIG = originalDisable
      }
      if (originalConfigDir === undefined) {
        delete process.env.LITEAI_CONFIG_DIR
      } else {
        process.env.LITEAI_CONFIG_DIR = originalConfigDir
      }
    }
  })
})

describe("LITEAI_CONFIG_CONTENT token substitution", () => {
  test("substitutes {env:} tokens in LITEAI_CONFIG_CONTENT", async () => {
    const originalEnv = process.env.LITEAI_CONFIG_CONTENT
    const originalTestVar = process.env.TEST_CONFIG_VAR
    process.env.TEST_CONFIG_VAR = "test_api_key_12345"
    process.env.LITEAI_CONFIG_CONTENT = JSON.stringify({
      $schema: "https://liteai.com/config.json",
      username: "{env:TEST_CONFIG_VAR}",
    })

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.username).toBe("test_api_key_12345")
        },
      })
    } finally {
      if (originalEnv !== undefined) {
        process.env.LITEAI_CONFIG_CONTENT = originalEnv
      } else {
        delete process.env.LITEAI_CONFIG_CONTENT
      }
      if (originalTestVar !== undefined) {
        process.env.TEST_CONFIG_VAR = originalTestVar
      } else {
        delete process.env.TEST_CONFIG_VAR
      }
    }
  })

  test("substitutes {file:} tokens in LITEAI_CONFIG_CONTENT", async () => {
    const originalEnv = process.env.LITEAI_CONFIG_CONTENT

    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Filesystem.write(path.join(dir, "api_key.txt"), "secret_key_from_file")
          process.env.LITEAI_CONFIG_CONTENT = JSON.stringify({
            $schema: "https://liteai.com/config.json",
            username: "{file:./api_key.txt}",
          })
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const config = await Config.get()
          expect(config.username).toBe("secret_key_from_file")
        },
      })
    } finally {
      if (originalEnv !== undefined) {
        process.env.LITEAI_CONFIG_CONTENT = originalEnv
      } else {
        delete process.env.LITEAI_CONFIG_CONTENT
      }
    }
  })
})

describe("sensitive field redaction", () => {
  test("redacts telemetry.langfuse.secretKey and mcp oauth clientSecret by default", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeConfig(dir, {
          $schema: "https://liteai.com/config.json",
          telemetry: {
            langfuse: {
              publicKey: "pk-123",
              secretKey: "sk-123",
            },
          },
          mcpServers: {
            test_server: {
              type: "remote",
              url: "http://example.com/mcp",
              oauth: {
                clientId: "client-123",
                clientSecret: "oauth-secret-123",
              },
            },
          },
        })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.telemetry?.langfuse?.publicKey).toBe("pk-123")
        expect(config.telemetry?.langfuse?.secretKey).toBe("*****")

        const mcpServer = config.mcpServers?.test_server as
          | { type?: string; oauth?: { clientId?: string; clientSecret?: string } }
          | undefined
        if (mcpServer && mcpServer.type === "remote" && mcpServer.oauth) {
          expect(mcpServer.oauth.clientId).toBe("client-123")
          expect(mcpServer.oauth.clientSecret).toBe("*****")
        } else {
          expect.unreachable("mcp server config was lost or malformed")
        }

        // test unredacted option
        const unredactedConfig = await Config.get({ unredacted: true })
        expect(unredactedConfig.telemetry?.langfuse?.secretKey).toBe("sk-123")
        const unredactedMcp = unredactedConfig.mcp?.test_server as
          | { type?: string; oauth?: { clientSecret?: string } }
          | undefined
        if (unredactedMcp && unredactedMcp.type === "remote" && unredactedMcp.oauth) {
          expect(unredactedMcp.oauth.clientSecret).toBe("oauth-secret-123")
        }
      },
    })
  })
})

describe("project config updates", () => {
  test("strips global-only fields like telemetry and server from project updates", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // update should strip telemetry and server
        await Config.update({
          username: "valid_update",
          telemetry: {
            disabled: true,
          },
          server: {
            port: 8080,
          },
        } as Parameters<typeof Config.update>[0])

        const rawFile = await Filesystem.readJson<Record<string, unknown>>(path.join(tmp.path, ".liteai", "settings.json"))
        expect(rawFile.username).toBe("valid_update")
        expect(rawFile.telemetry).toBeUndefined()
        expect(rawFile.server).toBeUndefined()
      },
    })
  })
})
