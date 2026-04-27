// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first

import { afterAll, beforeAll } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Set XDG env vars FIRST, before any src/ imports
const dir = path.join(os.tmpdir(), `liteai-test-data-${crypto.randomUUID()}`)

process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")
process.env.LITEAI_HOME = path.join(dir, "liteai")
process.env.LITEAI_MODELS_PATH = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")
// Use in-memory SQLite for test isolation — no stale DB files, no EBUSY on Windows
process.env.LITEAI_DB_MEMORY = "true"

// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
process.env.LITEAI_TEST_HOME = testHome

// Set test managed config directory to isolate tests from system managed settings
const testManagedConfigDir = path.join(dir, "managed")
process.env.LITEAI_TEST_MANAGED_CONFIG_DIR = testManagedConfigDir

// Clear provider and server auth env vars to ensure clean test state
delete process.env.ANTHROPIC_API_KEY
delete process.env.OPENAI_API_KEY
delete process.env.GOOGLE_API_KEY
delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
delete process.env.AZURE_OPENAI_API_KEY
delete process.env.AWS_ACCESS_KEY_ID
delete process.env.AWS_PROFILE
delete process.env.AWS_REGION
delete process.env.AWS_BEARER_TOKEN_BEDROCK
delete process.env.OPENROUTER_API_KEY
delete process.env.GROQ_API_KEY
delete process.env.MISTRAL_API_KEY
delete process.env.PERPLEXITY_API_KEY
delete process.env.TOGETHER_API_KEY
delete process.env.XAI_API_KEY
delete process.env.DEEPSEEK_API_KEY
delete process.env.FIREWORKS_API_KEY
delete process.env.CEREBRAS_API_KEY
delete process.env.SAMBANOVA_API_KEY
delete process.env.LITEAI_SERVER_PASSWORD
delete process.env.LITEAI_SERVER_USERNAME

beforeAll(async () => {
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(testHome, { recursive: true })

  // Write the cache version file to prevent global/index.ts from clearing the cache
  const cacheDir = path.join(dir, "cache", "liteai")
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, "version"), "14")

  const { Log } = await import("@liteai/util/log")
  await Log.init({ dir: require("node:os").tmpdir(), print: false, dev: true, level: "DEBUG" })

  const { Project } = await import("../src/project/project")
  await Project.fromDirectory(path.join(import.meta.dir, ".."))
})

afterAll(async () => {
  const { Database } = await import("../src/storage/db")
  Database.close()
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
})
