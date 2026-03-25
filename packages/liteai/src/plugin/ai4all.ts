import { setTimeout as sleep } from "node:timers/promises"
import { Installation } from "@/installation"
import type { Hooks, PluginInput } from "./types"

const APIGEE_HOST = "api-dev.valeo.com"
const BASE = `https://${APIGEE_HOST}/rsd/ai4all`
const POLL_INTERVAL_MS = 3000

function creds(id: string, secret: string) {
  return Buffer.from(`${id}:${secret}`).toString("base64")
}

export async function Ai4allAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "ai4all",
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
            const auth = await getAuth()
            if (!auth || auth.type !== "oauth") return fetch(request, init)

            const hdrs = new Headers(init?.headers)
            hdrs.set("Authorization", `Bearer ${auth.access}`)
            hdrs.set("x-ai4all-client", `liteai/${Installation.VERSION}`)
            hdrs.delete("x-api-key")

            return fetch(request, { ...init, headers: hdrs })
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
              instructions: "Sign in with your Google account in the browser.",
              method: "auto" as const,
              async callback() {
                // Poll the token-exchange endpoint with gcloud-less browser flow:
                // The callback URL returns a JSON with access_token + refresh_token.
                // We need the user to complete browser sign-in, then the callback
                // endpoint will have the tokens available.
                //
                // For the browser flow, we poll /auth/token with the authorization
                // code that the callback page displays. Since this is an "auto" method,
                // the TUI shows "waiting for authorization" while we poll.
                //
                // The AI4ALL /auth/callback redirects to a page that shows the tokens.
                // We use the client credentials to poll for the device code style flow.

                // Wait for the user to complete browser sign-in
                // The authorize endpoint starts a session; we poll token endpoint
                while (true) {
                  await sleep(POLL_INTERVAL_MS)

                  const poll = await fetch(`${BASE}/auth/token`, {
                    method: "POST",
                    headers: {
                      Authorization: `Basic ${creds(id, secret)}`,
                      "Content-Type": "application/x-www-form-urlencoded",
                      "x-ai4all-client": `liteai/${Installation.VERSION}`,
                    },
                    body: new URLSearchParams({
                      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
                      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
                      // The server tracks the pending auth session by client_id
                      client_id: id,
                    }),
                  }).catch(() => undefined)

                  if (!poll || !poll.ok) continue

                  const body = (await poll.json()) as {
                    access_token?: string
                    refresh_token?: string
                    expires_in?: number
                  }

                  if (!body.access_token) continue

                  return {
                    type: "success" as const,
                    access: body.access_token,
                    refresh: body.refresh_token ?? "",
                    expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
                  }
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
}
