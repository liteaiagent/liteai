import { Auth } from "@/auth"
import { Installation } from "@/installation"
import type { Hooks, PluginInput } from "./types"

const APIGEE_HOST = "api-dev.valeo.com"
const BASE = `https://${APIGEE_HOST}/rsd/ai4all`

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
            let auth = await getAuth()
            if (!auth || auth.type !== "oauth") return fetch(request, init)

            // Refresh if expired
            if (Date.now() >= auth.expires && auth.refresh) {
              const res = await fetch(`${BASE}/auth/token`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "x-ai4all-client": `liteai/${Installation.VERSION}`,
                },
                body: new URLSearchParams({
                  grant_type: "refresh_token",
                  refresh_token: auth.refresh,
                }),
              }).catch(() => undefined)

              if (res?.ok) {
                const body = (await res.json()) as {
                  access_token?: string
                  refresh_token?: string
                  expires_in?: number
                }
                if (body.access_token) {
                  const next: Auth.Info = {
                    type: "oauth",
                    access: body.access_token,
                    refresh: body.refresh_token ?? auth.refresh,
                    expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
                  }
                  await Auth.set("ai4all", next)
                  auth = next
                }
              }
            }

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
