/**
 * OAuth credential management — loading, saving, and interactive login.
 *
 * Adapted from gemini-cli/packages/core/src/code_assist/oauth2.ts:
 * 1. Load cached credentials from ~/.gemini/oauth_creds.json
 * 2. setCredentials on OAuth2Client
 * 3. Call client.getAccessToken() — auto-refreshes if expired
 * 4. Listen for 'tokens' event to save refreshed credentials
 * 5. Interactive OAuth login with PKCE + local callback server
 * 6. BYOID support via GoogleAuth.fromJSON()
 * 7. GOOGLE_CLOUD_ACCESS_TOKEN env bypass
 */

import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import * as http from "node:http"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { type AuthClient, CodeChallengeMethod, type Credentials, GoogleAuth, OAuth2Client } from "google-auth-library"
import { createLogger } from "../core/logger.js"

const logger = createLogger("auth.credentials")

// ── Auth Error ────────────────────────────────────────────────────────────

/**
 * Thrown when OAuth credentials are missing, expired, or revoked.
 * Callers should respond with 401 and guide the user to re-authenticate.
 */
export class AuthExpiredError extends Error {
  readonly code = "auth_expired"

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "AuthExpiredError"
    this.cause = cause
  }
}

// Same OAuth client ID/secret as Gemini CLI — allows reusing cached tokens
const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

// ── Path Helpers ──────────────────────────────────────────────────────────

export function getOauthCredsPath(): string {
  const configDir = process.env.GEMINI_CLI_CONFIG_DIR || join(homedir(), ".gemini")
  return join(configDir, "oauth_creds.json")
}

// ── Auth Status ───────────────────────────────────────────────────────────

export interface AuthStatus {
  authenticated: boolean
  email?: string
  credsPath: string
}

/**
 * Check whether valid cached credentials exist without triggering refresh.
 */
export function getAuthStatus(): AuthStatus {
  const credsPath = getOauthCredsPath()

  // 1. Env bypass
  if (process.env.GOOGLE_CLOUD_ACCESS_TOKEN) {
    return { authenticated: true, credsPath }
  }

  // 2. Check cached file
  if (!existsSync(credsPath)) {
    return { authenticated: false, credsPath }
  }

  try {
    const credsData = JSON.parse(readFileSync(credsPath, "utf-8")) as Credentials
    // If we have a refresh_token, we consider it authenticated
    // (the token may be expired but can be refreshed)
    if (credsData.refresh_token) {
      return { authenticated: true, credsPath }
    }
    // Access token without refresh — check expiry
    if (credsData.access_token) {
      if (credsData.expiry_date && credsData.expiry_date > Date.now()) {
        return { authenticated: true, credsPath }
      }
      // Expired with no refresh token
      return { authenticated: false, credsPath }
    }
  } catch {
    // Malformed file
  }

  return { authenticated: false, credsPath }
}

// ── Load Credentials ──────────────────────────────────────────────────────

/**
 * Load OAuth credentials matching gemini-cli's `initOauthClient` flow.
 *
 * Supports:
 * - GOOGLE_CLOUD_ACCESS_TOKEN env bypass
 * - BYOID (external_account_authorized_user) via GoogleAuth.fromJSON()
 * - Standard OAuth2 cached credentials with auto-refresh
 */
export async function loadOauthCredentials(): Promise<AuthClient> {
  // 1. Env bypass — GOOGLE_CLOUD_ACCESS_TOKEN
  const envToken = process.env.GOOGLE_CLOUD_ACCESS_TOKEN
  if (envToken) {
    logger.info("Using GOOGLE_CLOUD_ACCESS_TOKEN environment variable")
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    })
    client.setCredentials({ access_token: envToken })
    return client
  }

  const credsPath = getOauthCredsPath()

  if (!existsSync(credsPath)) {
    throw new AuthExpiredError(
      "OAuth credentials not found. " +
        "Use POST /auth/login to authenticate, or run `gemini` CLI first, " +
        "or set GEMINI_API_KEY for API key mode.",
    )
  }

  const credsData = JSON.parse(readFileSync(credsPath, "utf-8"))

  // 2. BYOID — external_account_authorized_user
  if (credsData.type === "external_account_authorized_user") {
    logger.info("Loading BYOID credentials (external_account_authorized_user)")
    const auth = new GoogleAuth()
    const client = auth.fromJSON(credsData)
    return client
  }

  // 3. Standard OAuth2
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  })

  // Auto-save refreshed tokens — merge with existing cached creds to preserve
  // refresh_token (the 'tokens' event from a refresh may only carry access_token)
  client.on("tokens", (tokens: Credentials) => {
    logger.info("Token refreshed, saving to disk...")
    try {
      let merged = tokens
      if (existsSync(credsPath)) {
        const existing = JSON.parse(readFileSync(credsPath, "utf-8")) as Credentials
        merged = { ...existing, ...tokens }
      }
      cacheCredentials(merged, credsPath)
    } catch {
      cacheCredentials(tokens, credsPath)
    }
  })

  // Set credentials from cached file (matching gemini-cli line 167)
  client.setCredentials(credsData as Credentials)

  // getAccessToken() auto-refreshes if expired (matching gemini-cli line 170)
  // If it fails, fall through with a clear error — gemini-cli falls through to
  // interactive login; we guide the user to POST /auth/login instead.
  try {
    const { token } = await client.getAccessToken()
    if (token) {
      logger.info("OAuth credentials loaded successfully.")
    } else {
      throw new Error("getAccessToken returned null")
    }
  } catch (err) {
    logger.error(`OAuth credential refresh failed: ${err}`)
    throw new AuthExpiredError(
      "OAuth credentials are invalid or expired. " + "Use POST /auth/login to re-authenticate, or run `gemini` CLI.",
      err,
    )
  }

  return client
}

// ── Interactive OAuth Login ───────────────────────────────────────────────

/**
 * Generate PKCE code verifier and challenge.
 */
function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 128)
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
  return { codeVerifier, codeChallenge }
}

export interface OAuthLoginResult {
  authUrl: string
  callbackPort: number
  /** Resolves when the user completes the OAuth flow */
  loginCompletePromise: Promise<{ email?: string }>
}

/**
 * Start an interactive OAuth login flow:
 * 1. Generate PKCE challenge
 * 2. Start a local HTTP server for the callback
 * 3. Return the auth URL for the user to open in a browser
 *
 * Adapted from gemini-cli's authWithWeb().
 */
export async function initiateOAuthLoginAsync(): Promise<OAuthLoginResult> {
  const { codeVerifier, codeChallenge } = generatePkce()

  return new Promise((resolveInit, rejectInit) => {
    const server = http.createServer()

    const loginCompletePromise = new Promise<{ email?: string }>((resolveLogin, rejectLogin) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        if (!addr || typeof addr === "string") {
          rejectInit(new Error("Failed to start callback server"))
          return
        }

        const port = addr.port
        const redirectUri = `http://localhost:${port}`

        const oauthClient = new OAuth2Client({
          clientId: OAUTH_CLIENT_ID,
          clientSecret: OAUTH_CLIENT_SECRET,
          redirectUri,
        })

        const authUrl = oauthClient.generateAuthUrl({
          access_type: "offline",
          scope: OAUTH_SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: CodeChallengeMethod.S256,
          prompt: "consent",
        })

        // Handle the callback
        server.on("request", async (req, res) => {
          try {
            const url = new URL(req.url || "/", `http://localhost:${port}`)
            const code = url.searchParams.get("code")

            if (!code) {
              res.writeHead(400, {
                "Content-Type": "text/html; charset=utf-8",
              })
              res.end("<h1>Error</h1><p>No authorization code received.</p>")
              return
            }

            const { tokens } = await oauthClient.getToken({
              code,
              codeVerifier,
            })

            cacheCredentials(tokens, getOauthCredsPath())
            logger.info("OAuth tokens cached successfully")

            let email: string | undefined
            try {
              email = await fetchUserEmail(tokens.access_token || "")
            } catch {
              logger.warn("Failed to fetch user email after login")
            }

            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
            })
            res.end(
              "<h1>✅ Authenticated!</h1>" +
                "<p>You can close this tab and return to your application.</p>" +
                "<script>window.close()</script>",
            )
            server.close()
            resolveLogin({ email })
          } catch (err) {
            logger.error(`OAuth callback error: ${err}`)
            res.writeHead(500, {
              "Content-Type": "text/html; charset=utf-8",
            })
            res.end(`<h1>Error</h1><p>Authentication failed: ${err}</p>`)
            server.close()
            rejectLogin(err)
          }
        })

        // Auto-close after 5 minutes
        setTimeout(
          () => {
            server.close()
            rejectLogin(new Error("OAuth login timed out after 5 minutes"))
          },
          5 * 60 * 1000,
        )

        // Server is ready — resolve with the auth URL
        resolveInit({
          authUrl,
          callbackPort: port,
          loginCompletePromise,
        })
      })

      server.on("error", (err) => {
        rejectInit(err)
      })
    })
  })
}

// ── Manual Auth Code Exchange ─────────────────────────────────────────────

/**
 * Exchange an authorization code for tokens (user-code flow).
 * Adapted from gemini-cli's authWithUserCode().
 */
export async function exchangeAuthCode(
  code: string,
  redirectUri = "urn:ietf:wg:oauth:2.0:oob",
): Promise<{ email?: string }> {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
    redirectUri,
  })

  const { tokens } = await client.getToken(code)
  cacheCredentials(tokens, getOauthCredsPath())
  logger.info("Auth code exchanged and tokens cached")

  let email: string | undefined
  try {
    email = await fetchUserEmail(tokens.access_token || "")
  } catch {
    logger.warn("Failed to fetch user email after code exchange")
  }

  return { email }
}

// ── Logout ────────────────────────────────────────────────────────────────

/**
 * Clear cached OAuth credentials.
 */
export function clearCachedCredentials(): boolean {
  const credsPath = getOauthCredsPath()
  if (existsSync(credsPath)) {
    unlinkSync(credsPath)
    logger.info(`Removed cached credentials: ${credsPath}`)
    return true
  }
  return false
}

// ── Helpers ───────────────────────────────────────────────────────────────

function cacheCredentials(credentials: Credentials, filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(credentials, null, 2), "utf-8")
    try {
      const { chmodSync } = require("node:fs")
      chmodSync(filePath, 0o600)
    } catch {
      // Windows doesn't support chmod
    }
  } catch (err) {
    logger.warn(`Failed to save credentials: ${err}`)
  }
}

/**
 * Fetch user email from Google userinfo endpoint.
 * Matching gemini-cli's fetchAndCacheUserInfo().
 */
async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`userinfo request failed: ${res.status}`)
  const data = (await res.json()) as { email?: string }
  return data.email || ""
}

// Re-export for use by code-assist-client's ensureValidToken
export { cacheCredentials as saveOauthCredentials }
