import { Env } from "@/env"
import { Log } from "@/util/log"
import type { LoaderInput, LoaderResult } from "./types"

const log = Log.create({ service: "provider.ai4all" })

const APIGEE_HOST = "api-dev.valeo.com"
const TOKEN_URL = `https://${APIGEE_HOST}/rsd/ai4all/auth/token-exchange`

let cached: { token: string; expires: number } | undefined

async function gcloud(): Promise<string | undefined> {
  const proc = Bun.spawn(["gcloud", "auth", "print-identity-token"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await proc.exited
  if (code !== 0) return undefined
  return new Response(proc.stdout).text().then((t) => t.trim())
}

async function exchange(id: string, secret: string): Promise<string | undefined> {
  const identity = await gcloud()
  if (!identity) {
    log.error("gcloud auth failed — run 'gcloud auth login' first")
    return undefined
  }

  const creds = Buffer.from(`${id}:${secret}`).toString("base64")
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "x-ai4all-client": "liteai/1.0.0",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: identity,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    }),
  })

  if (!res.ok) {
    log.error("token exchange failed", { status: res.status })
    return undefined
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) return undefined

  cached = {
    token: body.access_token,
    expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
  }
  log.info("token exchanged successfully")
  return body.access_token
}

async function token(input: LoaderInput): Promise<string | undefined> {
  // 1. Explicit env var (manual paste from llm-cli.sh)
  const key = Env.get("AI4ALL_API_KEY")
  if (key) return key

  // 2. Cached auto-exchanged token
  if (cached && Date.now() < cached.expires) return cached.token

  // 3. Auto-exchange via gcloud
  const id = input.options.clientId ?? Env.get("AI4ALL_CLIENT_ID")
  const secret = input.options.clientSecret ?? Env.get("AI4ALL_CLIENT_SECRET")
  if (!id || !secret) return undefined

  return exchange(id, secret)
}

export async function ai4all(input: LoaderInput): Promise<LoaderResult> {
  const key = await token(input)

  return {
    autoload: !!key,
    options: {
      ...(key && { apiKey: key }),
      headers: {
        "x-ai4all-client": "liteai/1.0.0",
      },
      fetch: async (url: unknown, init?: RequestInit) => {
        // Refresh token before each request if using auto-exchange
        if (!Env.get("AI4ALL_API_KEY") && cached && Date.now() >= cached.expires) {
          const id = input.options.clientId ?? Env.get("AI4ALL_CLIENT_ID")
          const secret = input.options.clientSecret ?? Env.get("AI4ALL_CLIENT_SECRET")
          if (id && secret) {
            const fresh = await exchange(id, secret)
            if (fresh && init?.headers) {
              const hdrs = new Headers(init.headers)
              hdrs.set("Authorization", `Bearer ${fresh}`)
              init = { ...init, headers: hdrs }
            }
          }
        }
        return fetch(url as string, init)
      },
    },
  }
}
