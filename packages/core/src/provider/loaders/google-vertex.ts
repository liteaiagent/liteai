import { GoogleAuth } from "google-auth-library"
import { Env } from "@/env"
import type { LoaderInput, LoaderResult, SDK } from "./types"

export async function googleVertex(input: LoaderInput): Promise<LoaderResult> {
  const project =
    input.options?.project ?? Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")

  const location = String(
    input.options?.location ??
      Env.get("GOOGLE_VERTEX_LOCATION") ??
      Env.get("GOOGLE_CLOUD_LOCATION") ??
      Env.get("VERTEX_LOCATION") ??
      "us-central1",
  )

  if (!project) return { autoload: false }
  return {
    autoload: true,
    vars() {
      const endpoint = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`
      return {
        ...(project && { GOOGLE_VERTEX_PROJECT: project }),
        GOOGLE_VERTEX_LOCATION: location,
        GOOGLE_VERTEX_ENDPOINT: endpoint,
      }
    },
    options: {
      project,
      location,
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        const auth = new GoogleAuth()
        const client = await auth.getApplicationDefault()
        const token = await client.credential.getAccessToken()
        const headers = new Headers(init?.headers)
        headers.set("Authorization", `Bearer ${token.token}`)
        return fetch(url, { ...init, headers })
      },
    },
    async getModel(sdk: SDK, modelID: string) {
      return sdk.languageModel(String(modelID).trim())
    },
  }
}

export async function googleVertexAnthropic(): Promise<LoaderResult> {
  const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
  const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
  if (!project) return { autoload: false }
  return {
    autoload: true,
    options: { project, location },
    async getModel(sdk: SDK, modelID: string) {
      return sdk.languageModel(String(modelID).trim())
    },
  }
}
