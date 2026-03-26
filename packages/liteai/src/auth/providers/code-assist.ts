import * as net from "node:net"
import os from "node:os"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import { Auth } from "../index"
import type { AuthProvider } from "../provider"
import { OAUTH_DUMMY_KEY } from "../service"

const log = Log.create({ service: "auth.code-assist" })

// OAuth Client ID for Google Code Assist (installed application — public per Google policy)
// https://developers.google.com/identity/protocols/oauth2#installed
const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const CLIENT_SECRET = "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"

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const HEADLESS_REDIRECT = "https://codeassist.google.com/authcode"

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type: string
}

interface PkceCodes {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, () => {
      const addr = server.address()
      const port = addr && typeof addr === "object" ? addr.port : 0
      server.close(() => resolve(port))
    })
    server.on("error", reject)
  })
}

function buildAuthUrl(redirect: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    scope: SCOPES.join(" "),
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

async function exchangeCode(code: string, redirect: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Token exchange failed: ${response.status} ${text}`)
  }
  return response.json()
}

async function refreshToken(refresh: string): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }
  return response.json()
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>LiteAI - Google Code Assist Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to LiteAI.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>LiteAI - Google Code Assist Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`

interface PendingOAuth {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let oauthPort: number | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ port: number; redirect: string }> {
  if (oauthServer && oauthPort) {
    return { port: oauthPort, redirect: `http://127.0.0.1:${oauthPort}/oauth2callback` }
  }

  const port = await getAvailablePort()
  oauthPort = port

  oauthServer = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/oauth2callback") {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const desc = url.searchParams.get("error_description")

        if (error) {
          const msg = desc || error
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(msg), {
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!code) {
          const msg = "Missing authorization code"
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(msg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        if (!pendingOAuth || state !== pendingOAuth.state) {
          const msg = "Invalid state - potential CSRF attack"
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(msg), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        const current = pendingOAuth
        pendingOAuth = undefined
        const redirect = `http://127.0.0.1:${port}/oauth2callback`

        exchangeCode(code, redirect, current.pkce)
          .then((tokens) => current.resolve(tokens))
          .catch((err) => current.reject(err))

        return new Response(HTML_SUCCESS, {
          headers: { "Content-Type": "text/html" },
        })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  log.info("code-assist oauth server started", { port })
  return { port, redirect: `http://127.0.0.1:${port}/oauth2callback` }
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.stop()
    oauthServer = undefined
    oauthPort = undefined
    log.info("code-assist oauth server stopped")
  }
}

function waitForCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      },
      5 * 60 * 1000,
    )

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

// Module-scoped cache so the expensive setup() API call runs once across all instances
let cached: { project?: string } | undefined

export const CodeAssistAuth: AuthProvider = {
  provider: "google-code-assist",
  async setup() {
    // Pre-cache is not possible without auth at boot time.
    // setup() is called once at daemon boot before any auth exists.
    // The actual setup resolves lazily inside the loader on first use.
  },
  auth: {
    async loader(getAuth) {
      const auth = await getAuth()
      if (auth.type !== "oauth") return {}

      // Build auth-aware fetch for both setup() and SDK requests
      const authFetch = async (request: RequestInfo | URL, init?: RequestInit) => {
        // Remove dummy API key authorization header
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            init.headers.delete("authorization")
            init.headers.delete("Authorization")
          } else if (Array.isArray(init.headers)) {
            init.headers = init.headers.filter(([key]) => key.toLowerCase() !== "authorization")
          } else {
            delete init.headers.authorization
            delete init.headers.Authorization
          }
        }

        const current = await getAuth()
        if (current.type !== "oauth") return fetch(request, init)

        // Refresh if expired or about to expire (30s buffer)
        if (!current.access || current.expires < Date.now() + 30_000) {
          log.info("refreshing code-assist access token")
          let tokens: TokenResponse
          try {
            tokens = await refreshToken(current.refresh)
          } catch (e) {
            log.error("code-assist token refresh failed", { error: e })
            throw e
          }
          await Auth.set("google-code-assist", {
            type: "oauth",
            refresh: tokens.refresh_token || current.refresh,
            access: tokens.access_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          })
          current.access = tokens.access_token
        }

        // Build headers with Bearer token
        const headers = new Headers()
        if (init?.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => {
              headers.set(key, value)
            })
          } else if (Array.isArray(init.headers)) {
            for (const [key, value] of init.headers) {
              if (value !== undefined) headers.set(key, String(value))
            }
          } else {
            for (const [key, value] of Object.entries(init.headers)) {
              if (value !== undefined) headers.set(key, String(value))
            }
          }
        }

        headers.set("Authorization", `Bearer ${current.access}`)

        return fetch(request, { ...init, headers }) as Promise<Response>
      }

      // Run setup to discover project + tier (cached per provider lifecycle)
      if (!cached) {
        try {
          const { setup } = await import("@/provider/sdk/code-assist/setup")
          const env = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID
          // biome-ignore lint/suspicious/noExplicitAny: generic sdk param
          const data = await setup({ fetch: authFetch as any }, env)
          cached = { project: data.project }
          log.info("code-assist setup complete", { project: data.project, tier: data.tier })
        } catch (err) {
          log.warn("code-assist setup failed, continuing without project", { error: err })
          cached = {}
        }
      }

      return {
        apiKey: OAUTH_DUMMY_KEY,
        project: cached.project,
        fetch: authFetch,
      }
    },
    methods: [
      {
        label: "Google Sign-In (browser)",
        type: "oauth",
        authorize: async () => {
          const { redirect } = await startOAuthServer()
          const pkce = await generatePKCE()
          const state = generateState()
          const url = buildAuthUrl(redirect, pkce, state)

          const promise = waitForCallback(pkce, state)

          return {
            url,
            instructions: "Complete authorization in your browser. This window will close automatically.",
            method: "auto" as const,
            callback: async () => {
              const tokens = await promise
              stopOAuthServer()
              return {
                type: "success" as const,
                refresh: tokens.refresh_token || "",
                access: tokens.access_token,
                expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              }
            },
          }
        },
      },
      {
        label: "Google Sign-In (headless)",
        type: "oauth",
        authorize: async () => {
          const pkce = await generatePKCE()
          const state = generateState()
          const url = buildAuthUrl(HEADLESS_REDIRECT, pkce, state)

          return {
            url,
            instructions: "Visit the URL above, authorize, and paste the code below.",
            method: "code" as const,
            callback: async (code: string) => {
              const tokens = await exchangeCode(code, HEADLESS_REDIRECT, pkce)
              return {
                type: "success" as const,
                refresh: tokens.refresh_token || "",
                access: tokens.access_token,
                expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              }
            },
          }
        },
      },
    ],
  },
  hooks: {
    "chat.headers": async (incoming, output) => {
      if (incoming.model.providerID !== "google-code-assist") return
      output.headers["User-Agent"] = `liteai/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`
    },
  },
}
