/**
 * Interactive chat client for gca-proxy.
 *
 * Usage: bun scripts/chat.ts [options]
 *
 * Authenticates with the API, lets you pick a model,
 * then streams a conversation with reasoning display.
 *
 * Options:
 *   --url <url>    Server URL (default: http://localhost:9000)
 *   --model <id>   Skip model selection, use this model directly
 *   --key <token>  Pre-generated API key (or set LITEAI_API_KEY)
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import * as jose from "jose"

// ── ANSI Helpers ───────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  bgCyan: "\x1b[46m",
  bgBlue: "\x1b[44m",
  white: "\x1b[37m",
}

// ── Config ─────────────────────────────────────────────────────────────────

const ISSUER = "liteai"
const ALGORITHM = "RS256"
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

function getArg(flags: string[]): string | undefined {
  const args = process.argv.slice(2)
  for (const flag of flags) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  }
  return undefined
}

const BASE_URL = getArg(["--url", "-u"]) || process.env.LITEAI_URL || "http://localhost:9000"
const EXPLICIT_MODEL = getArg(["--model", "-m"])
const EXPLICIT_KEY = getArg(["--key", "-k"])
const DEBUG = process.argv.includes("--verbose") || process.argv.includes("-v")

function debug(msg: string): void {
  if (DEBUG) console.log(`${c.gray}[debug] ${msg}${c.reset}`)
}

// ── Auth ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  // 1. Explicit flag or env
  const preSupplied = EXPLICIT_KEY || process.env.LITEAI_API_KEY
  if (preSupplied) return preSupplied

  // 2. Sign with private key
  const keyPaths = [join(appRoot, "keys", "api_private.pem"), join(homedir(), ".liteai", "keys", "api_private.pem")]

  let privatePem: string | undefined
  const envKey = process.env.LITEAI_API_PRIVATE_KEY
  if (envKey) {
    privatePem = envKey
  } else {
    for (const p of keyPaths) {
      if (existsSync(p)) {
        privatePem = readFileSync(p, "utf-8")
        break
      }
    }
  }

  if (!privatePem) {
    console.error(
      `${c.red}ERROR: No API key or private key found.${c.reset}\n` +
        `  Set LITEAI_API_KEY env var, or ensure keys/api_private.pem exists.\n` +
        `  Run: bun scripts/keygen.ts keys\n`,
    )
    process.exit(1)
  }

  const privateKey = await jose.importPKCS8(privatePem, ALGORITHM)
  return new jose.SignJWT({ sub: "chat-client@liteai.local" })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime("1h")
    .sign(privateKey)
}

// ── API Helpers ────────────────────────────────────────────────────────────

interface Model {
  id: string
  owned_by: string
}

async function fetchModels(token: string): Promise<Model[]> {
  const res = await fetch(`${BASE_URL}/v1/models`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET /v1/models → ${res.status}`)
  const body = (await res.json()) as { data: Model[] }
  return body.data
}

interface HealthResponse {
  status: string
  auth?: { mode?: string; authenticated?: boolean }
}

async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/health`)
  if (!res.ok) throw new Error(`GET /health → ${res.status}`)
  return (await res.json()) as HealthResponse
}

// ── OAuth Login ────────────────────────────────────────────────────────────

async function doOAuthLogin(): Promise<boolean> {
  console.log(`\n${c.yellow}Starting OAuth login...${c.reset}`)

  const res = await fetch(`${BASE_URL}/auth/login`, { method: "POST" })
  if (!res.ok) {
    const body = await res.text()
    console.log(`${c.red}Login failed: ${body.slice(0, 200)}${c.reset}`)
    return false
  }

  const { authUrl } = (await res.json()) as {
    authUrl: string
    callbackPort: number
  }

  console.log(`\n${c.bold}Open this URL in your browser:${c.reset}`)
  console.log(`${c.cyan}${authUrl}${c.reset}\n`)

  // Try to open browser automatically
  try {
    const open = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open"
    Bun.spawn([open, authUrl], { stdout: "ignore", stderr: "ignore" })
  } catch {
    // Manual open
  }

  // Poll auth status
  process.stdout.write(`${c.dim}Waiting for login`)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    process.stdout.write(".")
    try {
      const statusRes = await fetch(`${BASE_URL}/auth/status`)
      if (statusRes.ok) {
        const status = (await statusRes.json()) as {
          authenticated?: boolean
          email?: string
        }
        if (status.authenticated) {
          console.log(` ${c.green}✓${c.reset} ${c.dim}(${status.email ?? "authenticated"})${c.reset}`)
          return true
        }
      }
    } catch {
      // retry
    }
  }

  console.log(` ${c.red}timeout${c.reset}`)
  return false
}

// ── Streaming Chat ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

async function streamChat(
  token: string,
  model: string,
  messages: ChatMessage[],
): Promise<{ text: string; reasoning: string }> {
  const requestBody = {
    model,
    stream: true,
    messages,
  }

  debug(`POST ${BASE_URL}/v1/chat/completions`)
  debug(`Request: ${JSON.stringify(requestBody, null, 2)}`)

  const startTime = Date.now()
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    verbose: DEBUG,
  })

  debug(`Response: ${res.status} ${res.statusText} (${Date.now() - startTime}ms)`)
  debug(`Headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}`)

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`${res.status}: ${errBody.slice(0, 300)}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let fullText = ""
  let fullReasoning = ""
  let inReasoning = false
  let inContent = false
  let chunkCount = 0
  let firstChunkMs = 0

  while (true) {
    const result = await reader.read()
    if (!result || result.done) {
      debug("Stream ended (done=true)")
      break
    }

    const text = decoder.decode(result.value, { stream: true })
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      if (DEBUG && line.startsWith("data: ")) {
        const preview = line.slice(6, 200)
        debug(`SSE: ${preview}${line.length > 206 ? "..." : ""}`)
      }
      if (!line.startsWith("data: ")) continue
      const data = line.slice(6).trim()
      if (data === "[DONE]") continue

      try {
        const chunk = JSON.parse(data)
        chunkCount++
        if (chunkCount === 1) firstChunkMs = Date.now() - startTime
        const delta = chunk.choices?.[0]?.delta
        const finishReason = chunk.choices?.[0]?.finish_reason

        debug(`Chunk #${chunkCount}: delta=${JSON.stringify(delta)} finish=${finishReason ?? "null"}`)

        // Reasoning content
        if (delta?.reasoning_content) {
          if (!inReasoning) {
            inReasoning = true
            process.stdout.write(
              `\n${c.dim}${c.italic}${c.magenta}💭 Thinking...${c.reset}\n${c.dim}${c.italic}${c.gray}`,
            )
          }
          process.stdout.write(delta.reasoning_content)
          fullReasoning += delta.reasoning_content
        }

        // Text content
        if (delta?.content) {
          if (inReasoning && !inContent) {
            // Transition from reasoning → content
            inContent = true
            inReasoning = false
            process.stdout.write(`${c.reset}\n\n`)
          } else if (!inContent) {
            inContent = true
          }
          process.stdout.write(delta.content)
          fullText += delta.content
        }
      } catch {
        // partial JSON — ignore
      }
    }
  }

  // Reset styling
  process.stdout.write(c.reset)
  if (inContent || inReasoning) process.stdout.write("\n")

  const totalMs = Date.now() - startTime
  debug(`Stream complete: ${chunkCount} chunks, TTFC=${firstChunkMs}ms, total=${totalMs}ms`)
  debug(`Content: ${fullText.length} chars, Reasoning: ${fullReasoning.length} chars`)

  return { text: fullText, reasoning: fullReasoning }
}

// ── Interactive Model Selection ────────────────────────────────────────────

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

async function selectModel(rl: ReturnType<typeof createInterface>, models: Model[]): Promise<string> {
  console.log(`\n${c.bold}${c.cyan}Available Models:${c.reset}\n`)

  // Group — aliases first, then concrete models
  const aliases = ["auto", "pro", "flash", "flash-lite"]
  const concrete = models.map((m) => m.id).filter((id) => !aliases.includes(id))

  const all = [...aliases, ...concrete]
  for (let i = 0; i < all.length; i++) {
    const marker = i < aliases.length ? `${c.yellow}★${c.reset}` : " "
    console.log(`  ${c.dim}${String(i + 1).padStart(2)}.${c.reset} ${marker} ${all[i]}`)
  }

  console.log()
  const answer = await prompt(
    rl,
    `${c.cyan}Select model ${c.dim}[1-${all.length}]${c.reset}${c.cyan} or type name:${c.reset} `,
  )

  const num = Number.parseInt(answer.trim(), 10)
  if (num >= 1 && num <= all.length) return all[num - 1]
  if (answer.trim()) return answer.trim()
  return "auto" // default
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Help
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: bun scripts/chat.ts [options]")
    console.log()
    console.log("Options:")
    console.log("  --url, -u <url>     Server URL (default: http://localhost:9000)")
    console.log("  --model, -m <id>    Model to use (skips selection)")
    console.log("  --key, -k <token>   API key (or set LITEAI_API_KEY)")
    console.log("  --verbose, -v       Show debug logging (request/chunks)")
    console.log()
    console.log("Commands in chat:")
    console.log("  /login              Re-authenticate (OAuth)")
    console.log("  /model              Change model")
    console.log("  /clear              Clear conversation history")
    console.log("  /history            Show conversation history")
    console.log("  /quit, /exit        Exit")
    process.exit(0)
  }

  console.log(`\n${c.bold}${c.bgCyan}${c.white} LiteAI Chat Client ${c.reset}\n`)

  // 1. Health check
  process.stdout.write(`${c.dim}Connecting to ${BASE_URL}...${c.reset}`)
  let needsLogin = false
  try {
    const health = await checkHealth()
    const authInfo = health.auth
      ? ` ${c.dim}(${health.auth.mode}, ${health.auth.authenticated ? "✓ authenticated" : "✗ not authenticated"})${c.reset}`
      : ""
    console.log(` ${c.green}✓${c.reset}${authInfo}`)

    // Auto-detect expired OAuth
    if (
      health.auth &&
      (health.auth.mode === "oauth" || health.auth.mode === "compute-adc") &&
      !health.auth.authenticated
    ) {
      needsLogin = true
    }
  } catch (err) {
    console.log(` ${c.red}✗ ${err instanceof Error ? err.message : String(err)}${c.reset}`)
    process.exit(1)
  }

  // Auto-login if OAuth is expired
  if (needsLogin) {
    console.log(`${c.yellow}⚠ Backend OAuth is not authenticated. Starting login...${c.reset}`)
    const ok = await doOAuthLogin()
    if (!ok) {
      console.log(`${c.red}Login failed. Chat may not work. Use /login to retry.${c.reset}`)
    }
  }

  // 2. Auth
  process.stdout.write(`${c.dim}Authenticating...${c.reset}`)
  let token: string
  try {
    token = await getToken()
    console.log(` ${c.green}✓${c.reset}`)
  } catch (err) {
    console.log(` ${c.red}✗ ${err instanceof Error ? err.message : String(err)}${c.reset}`)
    process.exit(1)
  }

  // 3. Fetch models
  process.stdout.write(`${c.dim}Loading models...${c.reset}`)
  let models: Model[]
  try {
    models = await fetchModels(token)
    console.log(` ${c.green}✓${c.reset} ${c.dim}(${models.length} available)${c.reset}`)
  } catch (err) {
    console.log(` ${c.red}✗ ${err instanceof Error ? err.message : String(err)}${c.reset}`)
    process.exit(1)
  }

  // 4. Model selection
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  let currentModel: string
  if (EXPLICIT_MODEL) {
    currentModel = EXPLICIT_MODEL
    console.log(`\n${c.dim}Model:${c.reset} ${c.bold}${currentModel}${c.reset}`)
  } else {
    currentModel = await selectModel(rl, models)
  }

  // 5. Chat loop
  const history: ChatMessage[] = []

  console.log(`\n${c.bold}${c.cyan}━━━ Chat ━━━${c.reset}`)
  console.log(`${c.dim}Model: ${currentModel} • Type /help for commands • Ctrl+C to exit${c.reset}\n`)

  const ask = (): void => {
    rl.question(`${c.bold}${c.blue}You ›${c.reset} `, async (input: string) => {
      const trimmed = input.trim()
      if (!trimmed) {
        ask()
        return
      }

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        switch (trimmed.toLowerCase()) {
          case "/quit":
          case "/exit":
          case "/q":
            console.log(`\n${c.dim}Goodbye!${c.reset}\n`)
            rl.close()
            process.exit(0)
            break
          case "/clear":
            history.length = 0
            console.log(`${c.yellow}History cleared.${c.reset}\n`)
            break
          case "/model": {
            currentModel = await selectModel(rl, models)
            console.log(`${c.green}Switched to: ${currentModel}${c.reset}\n`)
            break
          }
          case "/history":
            if (history.length === 0) {
              console.log(`${c.dim}No messages yet.${c.reset}\n`)
            } else {
              for (const msg of history) {
                const prefix = msg.role === "user" ? `${c.blue}You${c.reset}` : `${c.green}AI${c.reset}`
                console.log(`  ${prefix}: ${msg.content.slice(0, 120)}${msg.content.length > 120 ? "..." : ""}`)
              }
              console.log()
            }
            break
          case "/login": {
            const ok = await doOAuthLogin()
            if (ok) {
              console.log(`${c.green}Login successful! Chat is ready.${c.reset}\n`)
            } else {
              console.log(`${c.red}Login failed. Try again with /login${c.reset}\n`)
            }
            break
          }
          case "/help":
            console.log(`\n${c.bold}Commands:${c.reset}`)
            console.log(`  ${c.cyan}/login${c.reset}    Re-authenticate (OAuth)`)
            console.log(`  ${c.cyan}/model${c.reset}    Change model`)
            console.log(`  ${c.cyan}/clear${c.reset}    Clear history`)
            console.log(`  ${c.cyan}/history${c.reset}  Show history`)
            console.log(`  ${c.cyan}/quit${c.reset}     Exit\n`)
            break
          default:
            console.log(`${c.yellow}Unknown command: ${trimmed}${c.reset}\n`)
        }
        ask()
        return
      }

      // Send message
      history.push({ role: "user", content: trimmed })

      process.stdout.write(`\n${c.bold}${c.green}AI ›${c.reset} `)
      try {
        const { text, reasoning } = await streamChat(token, currentModel, history)
        if (text) {
          history.push({ role: "assistant", content: text })
        }
        // Show stats
        if (reasoning) {
          console.log(`${c.dim}  (reasoning: ${reasoning.length} chars)${c.reset}`)
        }
      } catch (err) {
        console.log(`\n${c.red}Error: ${err instanceof Error ? err.message : String(err)}${c.reset}`)
      }
      console.log()
      ask()
    })
  }

  ask()

  // Handle Ctrl+C gracefully
  rl.on("close", () => {
    console.log(`\n${c.dim}Goodbye!${c.reset}\n`)
    process.exit(0)
  })
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
