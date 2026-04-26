#!/usr/bin/env bun
/**
 * Minimal entrypoint for integration-testing the LSP handler.
 *
 * Spawned as a subprocess by lsp-handler-integration.test.ts.
 * It initializes just enough of core (Log) and starts the LSP handler.
 * No HTTP server, no DB, no hosted mode — just LSP on stdio.
 */
import { Log } from "@liteai/util/log"

await Log.init({ dir: require("node:os").tmpdir(), print: false, dev: true, level: "DEBUG" })

const { startLSPHandler } = await import("../../../src/lsp/lsp-handler")
startLSPHandler()
