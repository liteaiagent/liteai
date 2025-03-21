/**
 * Auth routes — status, login, logout endpoints.
 *
 * These routes are public (no JWT middleware) and provide
 * interactive OAuth login capability for the server.
 */

import { Hono } from "hono"
import {
  clearCachedCredentials,
  exchangeAuthCode,
  getAuthStatus,
  initiateOAuthLoginAsync,
} from "../auth/credentials.js"
import { getAuthMode, getProjectId, getUserEmail, getUserTier, resetAuthState, setUserEmail } from "../auth/index.js"
import { createLogger } from "../core/logger.js"

const logger = createLogger("routes.auth")

export const authRoutes = new Hono()

// ── GET /status — Check authentication state ─────────────────────────────

authRoutes.get("/status", (c) => {
  const authMode = getAuthMode()
  const status = getAuthStatus()

  return c.json({
    authenticated: status.authenticated,
    authMode,
    email: getUserEmail() ?? undefined,
    tier: getUserTier() ?? undefined,
    projectId: getProjectId() ?? undefined,
    credsPath: status.credsPath,
  })
})

// ── POST /login — Start browser-based OAuth flow ─────────────────────────

authRoutes.post("/login", async (c) => {
  const authMode = getAuthMode()

  if (authMode !== "oauth") {
    return c.json(
      {
        error: {
          message: `Interactive login is only available in OAuth mode. Current mode: ${authMode}`,
          type: "invalid_request",
        },
      },
      400,
    )
  }

  try {
    const result = await initiateOAuthLoginAsync()

    logger.info(`OAuth login initiated — callback port: ${result.callbackPort}`)

    // Don't await the login completion — return immediately with the auth URL
    // The login will complete when the user visits the auth URL
    result.loginCompletePromise
      .then(({ email }) => {
        if (email) {
          setUserEmail(email)
          logger.info(`OAuth login completed for: ${email}`)
        } else {
          logger.info("OAuth login completed (no email retrieved)")
        }
        // Reset cached clients so next request uses new credentials
        resetAuthState()
      })
      .catch((err) => {
        logger.error(`OAuth login flow failed: ${err}`)
      })

    return c.json({
      authUrl: result.authUrl,
      callbackPort: result.callbackPort,
    })
  } catch (err) {
    logger.error(`Failed to initiate OAuth login: ${err}`)
    return c.json(
      {
        error: {
          message: `Failed to start OAuth flow: ${err}`,
          type: "server_error",
        },
      },
      500,
    )
  }
})

// ── POST /login/code — Manual auth code entry ───────────────────────────

authRoutes.post("/login/code", async (c) => {
  const authMode = getAuthMode()

  if (authMode !== "oauth") {
    return c.json(
      {
        error: {
          message: `Auth code login is only available in OAuth mode. Current mode: ${authMode}`,
          type: "invalid_request",
        },
      },
      400,
    )
  }

  const body = await c.req.json<{ code?: string }>()
  if (!body.code) {
    return c.json(
      {
        error: {
          message: 'Missing "code" field in request body',
          type: "invalid_request",
        },
      },
      400,
    )
  }

  try {
    const { email } = await exchangeAuthCode(body.code)
    if (email) {
      setUserEmail(email)
    }

    // Reset cached clients so next request uses new credentials
    resetAuthState()

    return c.json({
      authenticated: true,
      email: email ?? undefined,
    })
  } catch (err) {
    logger.error(`Auth code exchange failed: ${err}`)
    return c.json(
      {
        error: {
          message: `Auth code exchange failed: ${err}`,
          type: "authentication_error",
        },
      },
      401,
    )
  }
})

// ── POST /logout — Clear cached credentials ─────────────────────────────

authRoutes.post("/logout", (c) => {
  const removed = clearCachedCredentials()
  resetAuthState()

  return c.json({
    success: true,
    credentialsRemoved: removed,
  })
})
