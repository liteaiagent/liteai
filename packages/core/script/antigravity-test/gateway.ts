/**
 * Antigravity LSP — Gateway Verification
 *
 * Tests connectivity to a Language Server endpoint by sending
 * an HTTP POST to /exa.language_server_pb.LanguageServerService/GetUserStatus
 * with the CSRF token.
 *
 * Tries HTTPS first, then falls back to HTTP if HTTPS fails.
 */

import * as https from "node:https"
import * as http from "node:http"

export type Protocol = "https" | "http"

export interface GatewayResult {
  success: boolean
  statusCode: number
  protocol: Protocol
  data?: unknown
  error?: string
  latencyMs: number
}

const DEFAULT_ENDPOINT = "/exa.language_server_pb.LanguageServerService/GetUserStatus"

function doRequest(
  protocol: Protocol,
  hostname: string,
  port: number,
  path: string,
  csrfToken: string,
  body: string,
  timeout: number,
): Promise<{ statusCode: number; data: unknown; protocol: Protocol }> {
  return new Promise((resolve, reject) => {
    const mod = protocol === "https" ? https : http
    const opts: https.RequestOptions = {
      hostname,
      port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "X-Codeium-Csrf-Token": csrfToken,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout,
      agent: false,
      ...(protocol === "https" ? { rejectUnauthorized: false } : {}),
    }

    const req = mod.request(opts, (res) => {
      let responseBody = ""
      res.on("data", (chunk) => (responseBody += chunk))
      res.on("end", () => {
        try {
          const data = responseBody ? JSON.parse(responseBody) : {}
          resolve({ statusCode: res.statusCode || 0, data, protocol })
        } catch {
          if ((res.statusCode || 0) >= 400) {
            resolve({
              statusCode: res.statusCode || 0,
              data: { error: `HTTP ${res.statusCode}: ${responseBody.substring(0, 200)}` },
              protocol,
            })
          } else {
            reject(new Error(`Invalid JSON: ${responseBody.substring(0, 100)}`))
          }
        }
      })
    })

    req.on("error", (err) => reject(new Error(`${protocol.toUpperCase()} error: ${err.message}`)))
    req.on("timeout", () => { req.destroy(); reject(new Error(`${protocol.toUpperCase()} timeout`)) })
    req.write(body)
    req.end()
  })
}

/**
 * Verify server gateway — HTTPS first, then HTTP fallback.
 */
export async function verifyGateway(
  hostname: string,
  port: number,
  csrfToken: string,
  endpoint: string = DEFAULT_ENDPOINT,
): Promise<GatewayResult> {
  const body = JSON.stringify({
    metadata: {
      ideName: "liteai",
      extensionName: "liteai",
      locale: "en",
    },
  })

  const t0 = performance.now()

  // Try HTTPS
  try {
    const res = await doRequest("https", hostname, port, endpoint, csrfToken, body, 8_000)
    return {
      success: res.statusCode === 200,
      statusCode: res.statusCode,
      protocol: "https",
      data: res.data,
      latencyMs: Math.round(performance.now() - t0),
    }
  } catch (httpsError) {
    // Fallback to HTTP
    try {
      const res = await doRequest("http", hostname, port, endpoint, csrfToken, body, 8_000)
      return {
        success: res.statusCode === 200,
        statusCode: res.statusCode,
        protocol: "http",
        data: res.data,
        latencyMs: Math.round(performance.now() - t0),
      }
    } catch (httpError) {
      return {
        success: false,
        statusCode: 0,
        protocol: "https",
        error: `HTTPS: ${(httpsError as Error).message} | HTTP: ${(httpError as Error).message}`,
        latencyMs: Math.round(performance.now() - t0),
      }
    }
  }
}

/**
 * Raw HTTP request helper for arbitrary endpoints.
 */
export async function rawRequest<T = unknown>(
  protocol: Protocol,
  hostname: string,
  port: number,
  path: string,
  csrfToken: string,
  body: object,
  timeout = 8_000,
): Promise<{ statusCode: number; data: T; protocol: Protocol }> {
  return doRequest(protocol, hostname, port, path, csrfToken, JSON.stringify(body), timeout) as Promise<{
    statusCode: number
    data: T
    protocol: Protocol
  }>
}

// ── Standalone run ───────────────────────────────────────────────────

if (import.meta.main) {
  const port = Number(process.argv[2])
  const csrfToken = process.argv[3]

  if (!port || !csrfToken) {
    console.log("Usage: bun run gateway.ts <port> <csrf_token>")
    console.log("  Or run index.ts which auto-detects these values.")
    process.exit(1)
  }

  console.log(`🔗 Verifying gateway at 127.0.0.1:${port}...\n`)

  const result = await verifyGateway("127.0.0.1", port, csrfToken)

  if (result.success) {
    console.log(`✅ Gateway verified! (${result.protocol.toUpperCase()}, ${result.latencyMs}ms)`)
    console.log(`\n   Response:`)
    console.log(JSON.stringify(result.data, null, 2))
  } else {
    console.log(`❌ Gateway verification failed!`)
    console.log(`   Status: ${result.statusCode}`)
    console.log(`   Protocol: ${result.protocol}`)
    if (result.error) console.log(`   Error: ${result.error}`)
    if (result.data) console.log(`   Data: ${JSON.stringify(result.data, null, 2)}`)
  }
}
