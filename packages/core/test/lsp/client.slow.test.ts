import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { ChildProcess } from "node:child_process"
import path from "node:path"
import { Log } from "@liteai/util/log"
import { LSPClient } from "../../src/lsp/client"
import type { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"

// Per-test timeout: Instance.provide boots a full project context and
// LSPClient.create performs an initialize handshake. Under CI load this
// can exceed bun's 5 s default, causing flaky timeouts.
const TEST_TIMEOUT_MS = 15_000

// Minimal fake LSP server that speaks JSON-RPC over stdio
function spawnFakeServer() {
  const { spawn } = require("node:child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }) as ChildProcess,
  }
}

describe("LSPClient interop", () => {
  // Track resources for deterministic cleanup in afterEach.
  // Without this, a mid-test failure leaves the fake-server process alive
  // (bun reports "killed N dangling processes") and the leaked handle can
  // starve later tests of stdio descriptors on Windows.
  let activeHandle: { process: ChildProcess } | undefined
  let activeClient: LSPClient.Info | undefined

  beforeEach(async () => {
    await Log.init({ dir: require("node:os").tmpdir(), print: false })
  })

  afterEach(async () => {
    // Shutdown client first (sends LSP shutdown + exit, then kills process)
    if (activeClient) {
      try {
        await activeClient.shutdown()
      } catch (err) {
        // Shutdown may fail if the test itself errored before full init —
        // log but don't rethrow so other cleanup (force-kill) can proceed.
        console.error("activeClient.shutdown failed during test cleanup", err)
      }
      activeClient = undefined
    }
    // Belt-and-suspenders: force-kill the server process if still alive
    if (activeHandle?.process && activeHandle.process.exitCode === null) {
      activeHandle.process.kill("SIGKILL")
    }
    activeHandle = undefined
  })

  test(
    "handles workspace/workspaceFolders request",
    async () => {
      activeHandle = spawnFakeServer()

      const client = await Instance.provide({
        directory: process.cwd(),
        fn: () =>
          LSPClient.create({
            serverID: "fake",
            server: activeHandle as unknown as LSPServer.Handle,
            root: process.cwd(),
          }),
      })
      activeClient = client

      await client.connection.sendNotification("test/trigger", {
        method: "workspace/workspaceFolders",
      })

      await new Promise((r) => setTimeout(r, 100))

      expect(client.connection).toBeDefined()
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "handles client/registerCapability request",
    async () => {
      activeHandle = spawnFakeServer()

      const client = await Instance.provide({
        directory: process.cwd(),
        fn: () =>
          LSPClient.create({
            serverID: "fake",
            server: activeHandle as unknown as LSPServer.Handle,
            root: process.cwd(),
          }),
      })
      activeClient = client

      await client.connection.sendNotification("test/trigger", {
        method: "client/registerCapability",
      })

      await new Promise((r) => setTimeout(r, 100))

      expect(client.connection).toBeDefined()
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "handles client/unregisterCapability request",
    async () => {
      activeHandle = spawnFakeServer()

      const client = await Instance.provide({
        directory: process.cwd(),
        fn: () =>
          LSPClient.create({
            serverID: "fake",
            server: activeHandle as unknown as LSPServer.Handle,
            root: process.cwd(),
          }),
      })
      activeClient = client

      await client.connection.sendNotification("test/trigger", {
        method: "client/unregisterCapability",
      })

      await new Promise((r) => setTimeout(r, 100))

      expect(client.connection).toBeDefined()
    },
    TEST_TIMEOUT_MS,
  )
})
