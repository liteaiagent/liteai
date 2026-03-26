import { expect, test } from "bun:test"
import { dispatch } from "@/hook/hook"
import { load as loadPlugin } from "@/plugin/loader"
import { Instance } from "@/project/instance"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"

test("full integration test: plugin hooks.json -> run-hook.cmd -> session-start", async () => {
  // Use a designated temporary stub directory for the mock plugin
  const pluginRoot = await fs.mkdtemp(path.join(os.tmpdir(), "liteai-plugin-test-"))
  
  // 1. Create a stub hooks.json that relies on deep env variable expansion
  const hooksDir = path.join(pluginRoot, "hooks")
  await fs.mkdir(hooksDir, { recursive: true })
  
  const hooksJson = {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|clear|compact",
          hooks: [
            {
              type: "command",
              // We explicitly use the unexpanded variable to prove `expandDeep` does its job
              command: `"\${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start`,
              async: false
            }
          ]
        }
      ]
    }
  }
  
  await fs.writeFile(
    path.join(hooksDir, "hooks.json"),
    JSON.stringify(hooksJson)
  )

  // 2. Create the stub polyglot script (run-hook.cmd)
  // This will cleanly execute on Windows (via cmd.exe processing the @echo off block)
  // And on Unix (via bash parsing and ignoring the : << 'CMDBLOCK' block)
  const scriptContent = `#!/bin/bash
: << 'CMDBLOCK'
@echo off
echo {"hookSpecificOutput": {"hookEventName": "SessionStart", "additional_context": "You have superpowers stub payload"}}
exit /b 0
CMDBLOCK
echo '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additional_context": "You have superpowers stub payload"}}'
`
  const scriptPath = path.join(hooksDir, "run-hook.cmd")
  await fs.writeFile(scriptPath, scriptContent)
  try { await fs.chmod(scriptPath, 0o755) } catch {} // unix executable permission

  // 3. Test plugin loading and expansion phase (hooks.json)
  const loaded = await loadPlugin(pluginRoot)
  expect(loaded).toBeDefined()
  expect(loaded?.hooks).toBeDefined()
  expect(loaded?.hooks?.SessionStart).toBeDefined()

  // Ensure `expandDeep` properly substituted the string immediately:
  const hookCmd = (loaded?.hooks?.SessionStart?.[0] as any)?.hooks?.[0]?.command
  // The unexpanded `${CLAUDE_PLUGIN_ROOT}` should now be the actual `pluginRoot`
  expect(hookCmd).toContain(pluginRoot)

  // 4. Test Dispatch phase & Context extraction logic
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const res = await dispatch(
        "SessionStart",
        {
          cwd: process.cwd(),
          hook_event_name: "SessionStart",
          // The matcher looks for 'startup|clear|compact'
          source: "startup", 
        },
        { extra: loaded!.hooks }
      )
      
      expect(res).toBeDefined()
      // A successful completion implies the `.cmd` executed correctly
      expect(res.proceed).toBeTrue()
      
      // The payload must reflect our stub JSON
      expect(res.context).toBeDefined()
      expect(res.context).toContain("You have superpowers stub payload")
    }
  })
}, 30000)
