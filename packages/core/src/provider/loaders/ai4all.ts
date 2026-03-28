import { Auth } from "@/auth"
import { Env } from "@/env"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import type { LoaderInput, LoaderResult } from "./types"

const log = Log.create({ service: "provider.ai4all" })

const APIGEE_HOST = "api-dev.valeo.com"
const REFRESH_URL = `https://${APIGEE_HOST}/rsd/ai4all/auth/token`
const HEADER = `liteai/${Installation.VERSION}`

/**
 * Parse the `exp` claim from a JWT access token.
 * Returns the expiry as a Unix-ms timestamp, or 0 if parsing fails.
 */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1]
    if (!payload) return 0
    // Handle base64url → base64 conversion and padding
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, "base64").toString("utf-8")
    const { exp } = JSON.parse(json) as { exp?: number }
    return exp ? exp * 1000 : 0
  } catch {
    return 0
  }
}

/** 60-second buffer before considering a token expired (matches working CLI script). */
const EXPIRY_BUFFER_MS = 60_000

function isTokenExpired(auth: { access: string; expires: number }): boolean {
  // Prefer the JWT `exp` claim when available (more reliable than stored expires_in)
  const jwtExp = jwtExpiry(auth.access)
  const effectiveExpiry = jwtExp || auth.expires
  return Date.now() >= effectiveExpiry - EXPIRY_BUFFER_MS
}

async function refresh(input: LoaderInput): Promise<string | undefined> {
  const auth = await Auth.get("ai4all")
  if (!auth || auth.type !== "oauth") return undefined

  // If the access token is still valid, return it
  if (!isTokenExpired(auth)) return auth.access

  // Access token expired — try refresh
  if (!auth.refresh) {
    log.warn("access token expired but no refresh token available — re-login required")
    return undefined
  }

  const id = input.options.clientId ?? Env.get("AI4ALL_CLIENT_ID") ?? auth.clientId
  const secret = input.options.clientSecret ?? Env.get("AI4ALL_CLIENT_SECRET") ?? auth.clientSecret
  if (!id || !secret) {
    log.error("cannot refresh — no client credentials (AI4ALL_CLIENT_ID / AI4ALL_CLIENT_SECRET)")
    return undefined
  }

  log.info("access token expired, refreshing via refresh_token…")

  const creds = Buffer.from(`${id}:${secret}`).toString("base64")
  let res: Response
  try {
    res = await fetch(REFRESH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "x-ai4all-client": HEADER,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: auth.refresh,
      }),
    })
  } catch (err) {
    log.error("refresh request failed (network error)", { error: err })
    return undefined
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    log.error("refresh failed", { status: res.status, body })
    return undefined
  }

  const body = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!body.access_token) {
    log.error("refresh response missing access_token")
    return undefined
  }

  const expires = Date.now() + ((body.expires_in ?? 3600) - 60) * 1000
  await Auth.set("ai4all", {
    type: "oauth",
    access: body.access_token,
    refresh: body.refresh_token ?? auth.refresh,
    expires,
  })

  log.info("token refreshed successfully")
  return body.access_token
}

async function token(input: LoaderInput): Promise<string | undefined> {
  // 1. Explicit env var (manual paste)
  const key = Env.get("AI4ALL_API_KEY")
  if (key) return key

  // 2. OAuth stored credentials (with auto-refresh)
  return refresh(input)
}

export async function ai4all(input: LoaderInput): Promise<LoaderResult> {
  const key = await token(input)

  return {
    autoload: !!key,
    options: {
      ...(key && { apiKey: key }),
      headers: {
        "x-ai4all-client": HEADER,
      },
      fetch: async (url: unknown, init?: RequestInit) => {
        if (!Env.get("AI4ALL_API_KEY")) {
          const fresh = await refresh(input)
          if (fresh) {
            const hdrs = new Headers(init?.headers)
            hdrs.set("Authorization", `Bearer ${fresh}`)
            init = { ...init, headers: hdrs }
          }
        }

        const res = await fetch(url as string, init)

        // On 401, force a token refresh and retry once
        if (res.status === 401 && !Env.get("AI4ALL_API_KEY")) {
          log.warn("received 401 — forcing token refresh and retrying…")

          // Invalidate the stored expiry so refresh() actually calls the server
          const auth = await Auth.get("ai4all")
          if (auth && auth.type === "oauth") {
            await Auth.set("ai4all", { ...auth, expires: 0 })
          }

          const retryToken = await refresh(input)
          if (retryToken) {
            const hdrs = new Headers(init?.headers)
            hdrs.set("Authorization", `Bearer ${retryToken}`)
            return fetch(url as string, { ...init, headers: hdrs })
          }
        }

        return res
      },
    },
  }
}
