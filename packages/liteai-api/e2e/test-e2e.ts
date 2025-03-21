/**
 * E2E test for liteai-api-node server.
 *
 * Usage: npx tsx e2e/test-e2e.ts
 *
 * Expects the server to be running on localhost:9000.
 *
 * Auth: The test reads the private key from keys/api_private.pem
 * (or LITEAI_API_PRIVATE_KEY env var) and signs a short-lived JWT
 * to authenticate against the /v1/* routes.
 *
 * You can also pass a pre-generated token via LITEAI_API_KEY env var.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as jose from "jose"

const BASE_URL = process.env.LITEAI_URL || "http://localhost:9000"
const ISSUER = "liteai"
const ALGORITHM = "RS256"

interface TestResult {
  name: string
  passed: boolean
  duration: number
  error?: string
  skipped?: boolean
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now()
  try {
    await fn()
    results.push({ name, passed: true, duration: Date.now() - start })
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: msg,
    })
    console.log(`  ❌ ${name}: ${msg}`)
  }
}

function _skip(name: string, reason: string): void {
  results.push({ name, passed: true, duration: 0, skipped: true })
  console.log(`  ⏭️  ${name}: SKIPPED — ${reason}`)
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

// ── Auth Setup ────────────────────────────────────────────────────────────

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

async function generateTestToken(): Promise<string> {
  // 1. Pre-supplied token
  if (process.env.LITEAI_API_KEY) {
    console.log("  Using LITEAI_API_KEY env var for auth\n")
    return process.env.LITEAI_API_KEY
  }

  // 2. Sign with private key
  let privatePem: string | undefined

  const envKey = process.env.LITEAI_API_PRIVATE_KEY
  if (envKey) {
    privatePem = envKey
  } else {
    // Search for private key file
    const paths = [
      join(appRoot, "keys", "api_private.pem"),
      join(process.env.HOME || process.env.USERPROFILE || "", ".liteai", "keys", "api_private.pem"),
    ]
    for (const p of paths) {
      if (existsSync(p)) {
        privatePem = readFileSync(p, "utf-8")
        console.log(`  Using private key: ${p}\n`)
        break
      }
    }
  }

  if (!privatePem) {
    console.error(
      "ERROR: No API key or private key found.\n" +
        "  Set LITEAI_API_KEY env var with a valid JWT, or\n" +
        "  ensure keys/api_private.pem exists (run: bun scripts/keygen.ts keys)\n",
    )
    process.exit(1)
  }

  const privateKey = await jose.importPKCS8(privatePem, ALGORITHM)
  const token = await new jose.SignJWT({ sub: "e2e-test@liteai.local" })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime("1h")
    .sign(privateKey)

  return token
}

// ── Tests ──────────────────────────────────────────────────────────────────

interface HealthResponse {
  status: string
  auth?: { mode?: string; authenticated?: boolean }
}

async function run(): Promise<void> {
  console.log(`\n🧪 E2E Tests — ${BASE_URL}\n`)

  const token = await generateTestToken()
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }

  // ── 1. Health check (no auth required) ────────────────────────────────

  let backendAuth: { mode?: string; authenticated?: boolean } | undefined

  await test("GET /health returns 200", async () => {
    const res = await fetch(`${BASE_URL}/health`)
    assert(res.ok, `Expected 200, got ${res.status}`)
    const body = (await res.json()) as HealthResponse
    assert(body.status === "ok", `Expected status=ok, got ${body.status}`)
    backendAuth = body.auth
    if (backendAuth) {
      const authStr = backendAuth.authenticated ? "✓" : "✗"
      console.log(`    → Auth: mode=${backendAuth.mode}, authenticated=${authStr}`)
    }
  })

  // ── 2. Models endpoint ────────────────────────────────────────────────

  await test("GET /v1/models returns model list", async () => {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: authHeaders,
    })
    assert(res.ok, `Expected 200, got ${res.status}`)
    const body = (await res.json()) as { data: unknown[] }
    assert(Array.isArray(body.data), "Expected data to be an array")
    assert(body.data.length > 0, "Expected at least one model")
    console.log(`    → ${body.data.length} models available`)
  })

  // ── 3. Streaming chat completion (or auth-expired test) ───────────────

  const needsBackendAuth = backendAuth?.mode === "oauth" || backendAuth?.mode === "compute-adc"
  const isBackendAuthenticated = backendAuth?.authenticated !== false

  if (needsBackendAuth && !isBackendAuthenticated) {
    // Backend OAuth is expired — test that we get a clear 401
    await test("POST /v1/chat/completions returns 401 when auth expired", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          stream: true,
          messages: [{ role: "user", content: "Say hello in one word." }],
        }),
      })
      assert(res.status === 401, `Expected 401, got ${res.status}`)
      const body = (await res.json()) as {
        error?: { code?: string; message?: string }
      }
      assert(body.error?.code === "auth_expired", `Expected error.code=auth_expired, got ${body.error?.code}`)
      console.log(`    → ${body.error?.message}`)
    })

    // Also test that /auth/status reports the problem
    await test("GET /auth/status reports not authenticated", async () => {
      const res = await fetch(`${BASE_URL}/auth/status`)
      assert(res.ok, `Expected 200, got ${res.status}`)
      const body = (await res.json()) as { authenticated?: boolean }
      assert(body.authenticated === false, `Expected authenticated=false, got ${body.authenticated}`)
    })
  } else {
    // Backend auth OK (or api-key mode) — run the full streaming test
    await test("POST /v1/chat/completions (streaming)", async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          stream: true,
          messages: [{ role: "user", content: "Say hello in one word." }],
        }),
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`Expected 200, got ${res.status}: ${errBody.slice(0, 500)}`)
      }

      const contentType = res.headers.get("content-type") || ""
      assert(contentType.includes("text/event-stream"), `Expected SSE content-type, got ${contentType}`)

      // Read SSE stream
      const reader = res.body?.getReader()
      assert(reader !== undefined, "Response body reader is undefined")
      const decoder = new TextDecoder()
      let textContent = ""
      let reasoningContent = ""
      let chunkCount = 0
      let gotDone = false
      let gotRole = false

      while (true) {
        const result = await reader?.read()
        if (!result) break
        const { done, value } = result
        if (done) break

        const text = decoder.decode(value, { stream: true })
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") {
            gotDone = true
            continue
          }
          try {
            const chunk = JSON.parse(data)
            chunkCount++
            const delta = chunk.choices?.[0]?.delta
            if (delta?.role === "assistant") gotRole = true
            if (delta?.content) textContent += delta.content
            if (delta?.reasoning_content) reasoningContent += delta.reasoning_content
          } catch {
            // partial JSON — ignore
          }
        }
      }

      assert(gotRole, "Expected role=assistant in stream")
      assert(gotDone, "Expected [DONE] marker")
      assert(chunkCount >= 1, `Expected at least 1 chunk, got ${chunkCount}`)
      const hasOutput = textContent.length > 0 || reasoningContent.length > 0
      assert(
        hasOutput,
        `Expected text or reasoning content. text="${textContent}", reasoning="${reasoningContent.slice(0, 100)}"`,
      )
      console.log(`    → ${chunkCount} chunks streamed`)
      if (reasoningContent) console.log(`    → Reasoning: "${reasoningContent.slice(0, 100)}..."`)
      console.log(`    → Content: "${textContent.slice(0, 100)}"`)
    })
  }

  // ── 4. Invalid request ────────────────────────────────────────────────

  await test("POST /v1/chat/completions with bad body returns 400", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ model: "gemini-2.5-flash" }),
    })
    assert(res.status === 400, `Expected 400, got ${res.status}`)
  })

  // ── 5. 404 on unknown route ───────────────────────────────────────────

  await test("GET /v1/nonexistent returns 404", async () => {
    const res = await fetch(`${BASE_URL}/v1/nonexistent`, {
      headers: authHeaders,
    })
    assert(res.status === 404, `Expected 404, got ${res.status}`)
  })

  // ── 6. Auth — missing header returns 401 ──────────────────────────────

  await test("GET /v1/models without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/v1/models`)
    assert(res.status === 401, `Expected 401, got ${res.status}`)
  })

  // ── Summary ────────────────────────────────────────────────────────────

  console.log(`\n${"─".repeat(60)}`)
  const passed = results.filter((r) => r.passed && !r.skipped).length
  const skipped = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length
  const parts = [`${passed} passed`]
  if (skipped > 0) parts.push(`${skipped} skipped`)
  if (failed > 0) parts.push(`${failed} failed`)
  parts.push(`out of ${total} tests`)
  console.log(parts.join(", "))

  if (failed > 0) {
    console.log("\nFailed tests:")
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.error}`)
    }
    process.exit(1)
  } else {
    console.log("✅ All tests passed!\n")
  }
}

run().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
