import * as net from "node:net"
import { type Credentials, OAuth2Client } from "google-auth-library"
import { Log } from "@/util/log"
import { Auth } from "../index"
import type { AuthProvider } from "../provider"
import { OAUTH_DUMMY_KEY } from "../service"

const log = Log.create({ service: "auth.code-assist" })

// OAuth Client ID for Google Code Assist (installed application — public per Google policy)
// https://developers.google.com/identity/protocols/oauth2#installed
export const CA_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
export const CA_CLIENT_SECRET = "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"

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
    client_id: CA_CLIENT_ID,
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
      client_id: CA_CLIENT_ID,
      client_secret: CA_CLIENT_SECRET,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Token exchange failed: ${response.status} ${text}`)
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
  project?: string
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

function waitForCallback(pkce: PkceCodes, state: string, project?: string): Promise<TokenResponse> {
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
      project,
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

/** Project prompt shown during auth — optional, only needed for accounts that require it. */
const PROJECT_PROMPT = {
  type: "text" as const,
  key: "project",
  message: "Google Cloud Project ID (optional — only needed for some accounts)",
  placeholder: "my-gcp-project",
}

export const CodeAssistAuth: AuthProvider = {
  provider: "google-code-assist",
  auth: {
    async loader(getAuth) {
      const auth = await getAuth()
      if (auth.type !== "oauth") return {}

      // Create OAuth2Client matching gemini-cli's exact approach.
      // This uses google-auth-library's gaxios transport for all HTTP requests
      // to the Code Assist server, ensuring identical wire behavior.
      const oauthClient = new OAuth2Client({
        clientId: CA_CLIENT_ID,
        clientSecret: CA_CLIENT_SECRET,
      })

      // Set credentials from stored auth state
      oauthClient.setCredentials({
        access_token: auth.access,
        refresh_token: auth.refresh,
        expiry_date: auth.expires,
      })

      // Persist refreshed tokens — mirrors gemini-cli's oauth2.ts token event handler
      oauthClient.on("tokens", async (tokens: Credentials) => {
        const current = await getAuth()
        if (current.type !== "oauth") return
        await Auth.set("google-code-assist", {
          type: "oauth",
          refresh: tokens.refresh_token || current.refresh,
          access: tokens.access_token || current.access,
          expires: tokens.expiry_date ?? Date.now() + 3600 * 1000,
          // Preserve stored project across token refreshes
          ...(current.project ? { project: current.project } : {}),
        })
      })

      // Run setup to discover project + tier (cached per provider lifecycle).
      // Uses the project stored in auth.json — NOT env vars — so user can
      // freely modify GOOGLE_CLOUD_PROJECT without breaking the connection.
      if (!cached) {
        const storedProject = auth.project
        try {
          const { setup } = await import("@/provider/sdk/code-assist/setup")
          const data = await setup({ client: oauthClient }, storedProject)
          cached = { project: data.project }
          log.info("code-assist setup complete", { project: data.project, tier: data.tier })

          // If the server discovered a project and we didn't have one stored,
          // persist it so future loads don't depend on env vars.
          if (data.project && !storedProject) {
            const current = await getAuth()
            if (current.type === "oauth") {
              await Auth.set("google-code-assist", { ...current, project: data.project })
              log.info("persisted discovered project to auth", { project: data.project })
            }
          }
        } catch (err) {
          log.warn("code-assist setup failed, continuing without project", { error: err })
          cached = {}
        }
      }

      return {
        apiKey: OAUTH_DUMMY_KEY,
        project: cached.project,
        client: oauthClient,
        userAgentPrefix: `GeminiCLI/0.36.0`,
      }
    },
    methods: [
      {
        label: "Google Sign-In (browser)",
        type: "oauth",
        prompts: [PROJECT_PROMPT],
        authorize: async (inputs) => {
          const project = inputs?.project?.trim() || undefined
          const { redirect } = await startOAuthServer()
          const pkce = await generatePKCE()
          const state = generateState()
          const url = buildAuthUrl(redirect, pkce, state)

          const promise = waitForCallback(pkce, state, project)

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
                ...(project ? { project } : {}),
              }
            },
          }
        },
      },
      {
        label: "Google Sign-In (headless)",
        type: "oauth",
        prompts: [PROJECT_PROMPT],
        authorize: async (inputs) => {
          const project = inputs?.project?.trim() || undefined
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
                ...(project ? { project } : {}),
              }
            },
          }
        },
      },
    ],
  },
}
