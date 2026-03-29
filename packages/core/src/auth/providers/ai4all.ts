import { Auth } from "@/auth"
import { Env } from "@/env"
import { Installation } from "@/installation"
import { Log } from "@/util/log"
import type { AuthProvider } from "../provider"

const log = Log.create({ service: "auth.ai4all" })

const APIGEE_HOST = "api-dev.valeo.com"
const BASE = `https://${APIGEE_HOST}/rsd/ai4all`

/** 60-second buffer before considering a token expired (matches working CLI script). */
const EXPIRY_BUFFER_MS = 60_000

function creds(id: string, secret: string) {
  return Buffer.from(`${id}:${secret}`).toString("base64")
}

/**
 * Parse the `exp` claim from a JWT access token.
 * Returns the expiry as a Unix-ms timestamp, or 0 if parsing fails.
 */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1]
    if (!payload) return 0
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, "base64").toString("utf-8")
    const { exp } = JSON.parse(json) as { exp?: number }
    return exp ? exp * 1000 : 0
  } catch {
    return 0
  }
}

function isTokenExpired(auth: { access: string; expires: number }): boolean {
  const jwtExp = jwtExpiry(auth.access)
  const effectiveExpiry = jwtExp || auth.expires
  return Date.now() >= effectiveExpiry - EXPIRY_BUFFER_MS
}

async function doRefresh(auth: Auth.Info & { type: "oauth" }): Promise<Auth.Info | undefined> {
  if (!auth.refresh) return undefined

  const id = Env.get("AI4ALL_CLIENT_ID") ?? auth.clientId
  const secret = Env.get("AI4ALL_CLIENT_SECRET") ?? auth.clientSecret
  if (!id || !secret) {
    log.error("cannot refresh — no client credentials (AI4ALL_CLIENT_ID / AI4ALL_CLIENT_SECRET)")
    return undefined
  }

  log.info("refreshing ai4all access token…")

  const res = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds(id, secret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "x-ai4all-client": `liteai/${Installation.VERSION}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refresh,
    }),
  }).catch((err) => {
    log.error("refresh request failed (network error)", { error: err })
    return undefined
  })

  if (!res?.ok) {
    log.error("refresh failed", { status: res?.status })
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

  const next: Auth.Info = {
    type: "oauth",
    access: body.access_token,
    refresh: body.refresh_token ?? auth.refresh,
    expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
  }
  await Auth.set("ai4all", next)
  log.info("ai4all token refreshed successfully")
  return next
}

export const Ai4allAuth: AuthProvider = {
  provider: "ai4all",
  auth: {
    async loader(getAuth) {
      const info = await getAuth()
      if (!info) return {}

      if (info.type === "api") {
        return {
          apiKey: info.key,
          headers: { "x-ai4all-client": `liteai/${Installation.VERSION}` },
        }
      }

      if (info.type !== "oauth") return {}

      return {
        apiKey: "",
        headers: { "x-ai4all-client": `liteai/${Installation.VERSION}` },
        async fetch(request: RequestInfo | URL, init?: RequestInit) {
          let auth = await getAuth()
          if (!auth || auth.type !== "oauth") return fetch(request, init)

          // Proactively refresh if expired or about to expire (60s buffer)
          if (isTokenExpired(auth) && auth.refresh) {
            const next = await doRefresh(auth)
            if (next && next.type === "oauth") auth = next
          }

          const hdrs = new Headers(init?.headers)
          hdrs.set("Authorization", `Bearer ${auth.access}`)
          hdrs.set("x-ai4all-client", `liteai/${Installation.VERSION}`)
          hdrs.delete("x-api-key")

          const res = await fetch(request, { ...init, headers: hdrs })

          // On 401, force refresh and retry once
          if (res.status === 401 && auth.type === "oauth" && auth.refresh) {
            log.warn("received 401 — forcing token refresh and retrying…")
            // Invalidate stored expiry so doRefresh() calls the server
            await Auth.set("ai4all", { ...auth, expires: 0, clientId: auth.clientId, clientSecret: auth.clientSecret })
            const retried = await doRefresh({
              ...auth,
              expires: 0,
              clientId: auth.clientId,
              clientSecret: auth.clientSecret,
            })
            if (retried && retried.type === "oauth") {
              hdrs.set("Authorization", `Bearer ${retried.access}`)
              return fetch(request, { ...init, headers: hdrs })
            }
          }

          return res
        },
      }
    },
    methods: [
      {
        type: "oauth",
        label: "Login with Google (AI4ALL)",
        prompts: [
          {
            type: "text",
            key: "clientId",
            message: "Enter your AI4ALL Client ID",
            placeholder: "client-id",
            validate: (v: string) => (v ? undefined : "Client ID is required"),
          },
          {
            type: "text",
            key: "clientSecret",
            message: "Enter your AI4ALL Client Secret",
            placeholder: "client-secret",
            validate: (v: string) => (v ? undefined : "Client Secret is required"),
          },
        ],
        async authorize(inputs = {}) {
          const id = inputs.clientId as string
          const secret = inputs.clientSecret as string

          const res = await fetch(`${BASE}/auth/authorize`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${creds(id, secret)}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "x-ai4all-client": `liteai/${Installation.VERSION}`,
            },
            body: new URLSearchParams({
              redirect_uri: `${BASE}/auth/callback`,
              scope: "openid email profile",
            }),
            redirect: "manual",
          })

          const url = res.headers.get("location")
          if (!url) throw new Error("Failed to get authorization URL from AI4ALL")

          return {
            url,
            instructions: "Sign in with your Google account in the browser, then paste the JSON shown on the page.",
            method: "code" as const,
            async callback(raw: string) {
              const body = JSON.parse(raw) as {
                access_token: string
                refresh_token?: string
                expires_in?: number
              }
              return {
                type: "success" as const,
                access: body.access_token,
                refresh: body.refresh_token ?? "",
                expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
                clientId: id,
                clientSecret: secret,
              }
            },
          }
        },
      },
      {
        type: "api",
        label: "Paste API key",
      },
    ],
  },
}
